#!/usr/bin/env bash
# Install one pinned CI tool binary, verified, with three sources in order:
#
# 1. A cached copy of the release download (actions/cache restores it into
#    PUBMAX_TOOL_CACHE). It is used only when its sha256 still matches the pin.
# 2. The GitHub release download, retried over a window of several minutes.
#    It is used only when its sha256 matches the pin.
# 3. A source that does not use GitHub release downloads, verified on its own
#    terms: a PyPI wheel installed with --require-hashes, or a Go module built
#    with `go install` through proxy.golang.org and checked against
#    sum.golang.org, or a digest-pinned Docker Hub image with a binary checksum.
#
# GitHub release assets answered 504 to hosted runners for most of an hour on
# 8 Nov 2026, while Security CI was a required check. docs/CI_RUNBOOK.md,
# "What a job installs". The pins live in the workflow step that calls this.
#
# Inputs (environment):
#   TOOL_NAME            binary name, for example zizmor
#   TOOL_VERSION         pinned version, for example 1.30.1
#   TOOL_URL             GitHub release asset URL
#   TOOL_SHA256          sha256 of that asset
#   TOOL_ARCHIVE         "tar.gz", "tar.xz" (binary at root), or "binary"
#   TOOL_FALLBACK        "pip", "go", or "docker"
#   TOOL_PIP_REQUIREMENT for pip: "name==version --hash=sha256:<wheel sha256>"
#   TOOL_GO_MODULE       for go: "module/path/cmd/name@vX.Y.Z"
#   TOOL_IMAGE           for docker: image pinned by sha256 digest
#   TOOL_IMAGE_PATH      for docker: binary path inside the image
#   TOOL_BINARY_SHA256   for docker: sha256 of the copied linux/amd64 binary
#   PUBMAX_TOOL_CACHE    cache directory (default ~/.cache/pubmax-tools)
#   PUBMAX_TOOL_BIN      install directory (default /usr/local/bin)

set -euo pipefail

: "${TOOL_NAME:?}" "${TOOL_VERSION:?}" "${TOOL_URL:?}" "${TOOL_SHA256:?}" "${TOOL_ARCHIVE:?}" "${TOOL_FALLBACK:?}"
cache_dir="${PUBMAX_TOOL_CACHE:-$HOME/.cache/pubmax-tools}"
bin_dir="${PUBMAX_TOOL_BIN:-/usr/local/bin}"
asset="$cache_dir/$TOOL_NAME-$TOOL_VERSION-$TOOL_SHA256"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

matches_pin() {
  [ -f "$1" ] && [ "$(sha256sum "$1" | awk '{ print $1 }')" = "$TOOL_SHA256" ]
}

place() {
  if [ -w "$bin_dir" ]; then
    install -m 0755 "$1" "$bin_dir/$TOOL_NAME"
  else
    sudo install -m 0755 "$1" "$bin_dir/$TOOL_NAME"
  fi
}

from_asset() {
  case "$TOOL_ARCHIVE" in
    tar.gz|tar.xz)
      tar --extract --file "$asset" --directory "$work" "$TOOL_NAME"
      place "$work/$TOOL_NAME"
      ;;
    binary) place "$asset" ;;
    *) echo "unknown TOOL_ARCHIVE $TOOL_ARCHIVE" >&2; exit 2 ;;
  esac
}

from_fallback() {
  case "$TOOL_FALLBACK" in
    pip)
      : "${TOOL_PIP_REQUIREMENT:?}"
      python3 -m venv "$work/venv"
      printf '%s\n' "$TOOL_PIP_REQUIREMENT" > "$work/requirements.txt"
      "$work/venv/bin/pip" install --quiet --no-deps --only-binary=:all: --require-hashes \
        --requirement "$work/requirements.txt"
      place "$work/venv/bin/$TOOL_NAME"
      ;;
    go)
      : "${TOOL_GO_MODULE:?}"
      # A hosted runner keeps Go in its tool cache, not always on PATH.
      if ! command -v go >/dev/null 2>&1; then
        go_bin="$(find "${RUNNER_TOOL_CACHE:-/opt/hostedtoolcache}/go" -mindepth 3 -maxdepth 3 -type d -path '*/x64/bin' 2>/dev/null | sort -V | tail -n 1)"
        [ -n "$go_bin" ] || { echo "no Go toolchain for the $TOOL_NAME fallback" >&2; exit 1; }
        PATH="$go_bin:$PATH"
      fi
      # proxy.golang.org only (no direct VCS fetch), and every module checked
      # against the checksum database. GOTOOLCHAIN=auto fetches a newer Go
      # from the same proxy when the module needs one.
      GOBIN="$work/gobin" GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org \
        GOTOOLCHAIN=auto GOFLAGS=-mod=mod go install "$TOOL_GO_MODULE"
      # The build records the module version it was made from; it must be the pin.
      go version -m "$work/gobin/$TOOL_NAME" | grep -qE "^[[:space:]]+mod[[:space:]].*[[:space:]]v${TOOL_VERSION//./\\.}([[:space:]]|$)" || {
        echo "$TOOL_NAME was not built from v$TOOL_VERSION" >&2
        exit 1
      }
      place "$work/gobin/$TOOL_NAME"
      ;;
    docker)
      : "${TOOL_IMAGE:?}" "${TOOL_IMAGE_PATH:?}" "${TOOL_BINARY_SHA256:?}"
      [[ "$TOOL_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || {
        echo "TOOL_IMAGE must be pinned by sha256 digest" >&2
        exit 1
      }
      docker pull --platform linux/amd64 "$TOOL_IMAGE"
      container="$(docker create --platform linux/amd64 "$TOOL_IMAGE")"
      if ! docker cp "$container:$TOOL_IMAGE_PATH" "$work/$TOOL_NAME"; then
        docker rm "$container" >/dev/null
        return 1
      fi
      docker rm "$container" >/dev/null
      [ "$(sha256sum "$work/$TOOL_NAME" | awk '{ print $1 }')" = "$TOOL_BINARY_SHA256" ] || {
        echo "$TOOL_NAME binary checksum mismatch" >&2
        exit 1
      }
      place "$work/$TOOL_NAME"
      ;;
    *) echo "unknown TOOL_FALLBACK $TOOL_FALLBACK" >&2; exit 2 ;;
  esac
}

mkdir -p "$cache_dir"
if matches_pin "$asset"; then
  source=cache
else
  rm -f "$asset"
  if curl --fail --location --silent --show-error \
    --retry 8 --retry-delay 15 --retry-max-time 300 --retry-all-errors --connect-timeout 30 \
    --output "$asset.part" "$TOOL_URL" && matches_pin "$asset.part"; then
    mv "$asset.part" "$asset"
    source=release
  else
    rm -f "$asset.part"
    source=fallback
  fi
fi

if [ "$source" = fallback ]; then
  echo "::warning::$TOOL_NAME $TOOL_VERSION: the release download failed or did not match its checksum; installing through $TOOL_FALLBACK."
  from_fallback
else
  from_asset
fi
echo "Installed $TOOL_NAME $TOOL_VERSION from the $source source."
