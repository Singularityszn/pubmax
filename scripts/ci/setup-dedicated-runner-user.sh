#!/usr/bin/env bash
# Move the pubmax self-hosted runners off the Mac's login user.
#
# Before: three runners (karan-mac-pubmax, -2, -3) run as the console user,
# from ~/actions-runner-pubmax*, under LaunchAgents. Pull request code and
# every npm install script can read ~/.ssh, the gh token and the key files in
# that home, and can overwrite the Homebrew binaries later jobs reuse.
#
# After:
#   ghrunner   standard user, no admin, no password, no keychain, no SSH or gh
#              state. Runs the three pull request runners (label pubmax-mac).
#   ghrefresh  a second user of the same kind. Runs one runner for the jobs
#              that hold a write token or a secret (label pubmax-mac-refresh),
#              so pull request code never runs as the user that holds them.
#   Each runner is a fresh, checksum-verified install registered from scratch
#   and started by a LaunchDaemon with UserName set. The console user's home
#   is closed to other users (chmod 700), so neither runner user can read it.
#
# Usage, from the repository root, as the console (admin) user, never as root:
#   scripts/ci/setup-dedicated-runner-user.sh            # dry run: print the plan
#   scripts/ci/setup-dedicated-runner-user.sh --apply    # make the changes
#   scripts/ci/setup-dedicated-runner-user.sh --apply --force
#                                    # also when a runner is busy (kills its job)
#
# The script calls sudo for each privileged step and the console user's own gh
# login for runner tokens. It is idempotent: a second --apply finds each step
# done and skips it. docs/CI_RUNBOOK.md, section 'Dedicated runner users', is
# the runbook, including the rollback.
set -euo pipefail

REPO="Singularityszn/pubmax"
RUNNER_VERSION="2.337.0"
RUNNER_TARBALL="actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
RUNNER_SHA256="5a2cd92908a93d7276a194e1de6008099f3e7946f3f8e14aa7a1a7b4a31fdec2"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_TARBALL}"

PR_USER="ghrunner"
PRIVILEGED_USER="ghrefresh"
PR_LABEL="pubmax-mac"
PRIVILEGED_LABEL="pubmax-mac-refresh"

# name:user:label:default PW_PORT. Playwright jobs need a distinct port per
# runner on one Mac; an existing runner's PW_PORT is carried over when set.
RUNNERS=(
  "karan-mac-pubmax:${PR_USER}:${PR_LABEL}:3200"
  "karan-mac-pubmax-2:${PR_USER}:${PR_LABEL}:3210"
  "karan-mac-pubmax-3:${PR_USER}:${PR_LABEL}:3220"
  "karan-mac-pubmax-refresh:${PRIVILEGED_USER}:${PRIVILEGED_LABEL}:3230"
)

# PATH the runner service starts with. Homebrew is read and executed from
# here, and only the console user can write it.
RUNNER_PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Commands below run as the runner users, who cannot enter the console user's
# home once it is closed, so nothing may depend on the current directory.
cd /
APPLY=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() {
  printf 'setup-dedicated-runner-user: %s\n' "$*" >&2
  exit 1
}

# Run a command that changes the machine. A dry run prints it instead.
change() {
  if [ "$APPLY" -eq 1 ]; then
    printf '   + %s\n' "$*"
    "$@"
  else
    printf '   would run: %s\n' "$*"
  fi
}

label_for() { printf 'actions.runner.%s.%s' "${REPO/\//-}" "$1"; }
plist_for() { printf '/Library/LaunchDaemons/%s.plist' "$(label_for "$1")"; }
user_exists() { dscl . -read "/Users/$1" UniqueID >/dev/null 2>&1; }
home_of() { dscl . -read "/Users/$1" NFSHomeDirectory | awk '{print $2}'; }

# A read that needs root. A dry run never prompts for a password: without a
# cached sudo ticket the read fails and the step is reported as not done.
root_read() {
  if [ "$APPLY" -eq 1 ]; then sudo "$@"; else sudo -n "$@" 2>/dev/null; fi
}

# The first id from $2 upward that no record of type $1 (Users or Groups) uses
# and this run has not already handed out. A dry run creates nothing, so the
# hand-outs are what keep its plan from giving two users the same id.
TAKEN_IDS=""
free_id() {
  local kind="$1" id="$2" attr="UniqueID"
  [ "$kind" = "Groups" ] && attr="PrimaryGroupID"
  while dscl . -list "/$kind" "$attr" | awk '{print $2}' | grep -qx "$id" ||
    printf '%s\n' "$TAKEN_IDS" | grep -qx "${kind}:${id}"; do
    id=$((id + 1))
  done
  printf '%s' "$id"
}
take_id() { TAKEN_IDS="${TAKEN_IDS}$1:$2"$'\n'; }

# ---------------------------------------------------------------------------
say "Preflight"

[ "$(uname -s)" = "Darwin" ] || die "this script is for macOS"
[ "$(id -u)" -ne 0 ] || die "run as the console user, not root; the script calls sudo itself"
CONSOLE_USER="$(stat -f %Su /dev/console)"
[ "$(id -un)" = "$CONSOLE_USER" ] || die "run as the console user ${CONSOLE_USER}"
id -Gn | tr ' ' '\n' | grep -qx admin || die "${CONSOLE_USER} must be an admin to create users"
CONSOLE_HOME="$(home_of "$CONSOLE_USER")"
command -v gh >/dev/null || die "gh is not on PATH"
[ "$(gh api "repos/${REPO}" --jq .permissions.admin)" = "true" ] ||
  die "gh is not logged in as an admin of ${REPO}"
note "console user ${CONSOLE_USER} (${CONSOLE_HOME}), gh admin on ${REPO}"
if [ "$APPLY" -eq 1 ]; then
  note "mode: apply"
  sudo -v
else
  note "mode: dry run (pass --apply to make these changes)"
fi

busy="$(gh api "repos/${REPO}/actions/runners" --paginate --jq '.runners[] | select(.busy) | .name')"
if [ -n "$busy" ]; then
  if [ "$FORCE" -eq 1 ]; then
    note "busy runners, continuing because of --force: ${busy//$'\n'/, }"
  else
    die "busy runners: ${busy//$'\n'/, }. Wait for their jobs, or pass --force to cancel them."
  fi
fi

# ---------------------------------------------------------------------------
say "Runner users"

for user in "$PR_USER" "$PRIVILEGED_USER"; do
  if dscl . -read "/Groups/${user}" PrimaryGroupID >/dev/null 2>&1; then
    gid="$(dscl . -read "/Groups/${user}" PrimaryGroupID | awk '{print $2}')"
    note "group ${user} exists (gid ${gid})"
  else
    gid="$(free_id Groups 450)"
    take_id Groups "$gid"
    change sudo dseditgroup -o create -i "$gid" -r "PubMaxxing CI ${user}" "$user"
  fi
  if user_exists "$user"; then
    note "${user} exists (uid $(id -u "$user"))"
  else
    uid="$(free_id Users 450)"
    take_id Users "$uid"
    change sudo dscl . -create "/Users/${user}"
    change sudo dscl . -create "/Users/${user}" UniqueID "$uid"
    change sudo dscl . -create "/Users/${user}" PrimaryGroupID "$gid"
    change sudo dscl . -create "/Users/${user}" RealName "PubMaxxing CI ${user}"
    change sudo dscl . -create "/Users/${user}" NFSHomeDirectory "/Users/${user}"
    # No password and no login shell: nobody signs in as this user, so no
    # login keychain is ever created for it.
    change sudo dscl . -create "/Users/${user}" UserShell /usr/bin/false
    change sudo dscl . -create "/Users/${user}" Password '*'
    change sudo dscl . -create "/Users/${user}" IsHidden 1
  fi
  if [ -d "/Users/${user}" ]; then
    note "/Users/${user} exists"
  else
    change sudo mkdir -p "/Users/${user}/Library/Logs"
    change sudo chown -R "${user}:${user}" "/Users/${user}"
  fi
  change sudo chmod 700 "/Users/${user}"
  if user_exists "$user" && id -Gn "$user" | tr ' ' '\n' | grep -qx admin; then
    change sudo dseditgroup -o edit -d "$user" -t user admin
  fi
done

# ---------------------------------------------------------------------------
say "Close ${CONSOLE_HOME} to other users"

mode="$(stat -f %Lp "$CONSOLE_HOME")"
if [ "$mode" = "700" ]; then
  note "${CONSOLE_HOME} is already 700"
else
  note "${CONSOLE_HOME} is ${mode}; any local user can list it and read what it holds"
  change chmod 700 "$CONSOLE_HOME"
fi

# ---------------------------------------------------------------------------
say "Retire the runners that run as ${CONSOLE_USER}"

carry_port() {
  # Print the PW_PORT an old runner set in its .env, if any. Only that one
  # line is read; nothing else in the file is carried over.
  local env_file="$1/.env"
  [ -f "$env_file" ] || return 0
  sed -n 's/^PW_PORT=\([0-9][0-9]*\)$/\1/p' "$env_file" | head -n 1
}

# "name port" lines, one per retired runner that set PW_PORT. (macOS ships
# bash 3.2, which has no associative arrays.)
OLD_PORTS=""
old_port() { printf '%s\n' "$OLD_PORTS" | awk -v n="$1" '$1 == n {print $2; exit}'; }
for dir in "$CONSOLE_HOME"/actions-runner-pubmax*; do
  [ -d "$dir" ] || continue
  case "$dir" in *.retired-*) continue ;; esac
  if [ ! -f "$dir/.runner" ]; then
    note "${dir} is not configured; skipping"
    continue
  fi
  name="$(sed -n 's/.*"agentName": *"\([^"]*\)".*/\1/p' "$dir/.runner" | head -n 1)"
  port="$(carry_port "$dir")"
  [ -n "$port" ] && OLD_PORTS="${OLD_PORTS}${name} ${port}"$'\n'
  note "${name} in ${dir}${port:+ (PW_PORT=${port})}"
  if [ "$APPLY" -eq 1 ]; then
    (cd "$dir" && ./svc.sh stop || true)
    (cd "$dir" && ./svc.sh uninstall || true)
    remove_token="$(gh api -X POST "repos/${REPO}/actions/runners/remove-token" --jq .token)"
    (cd "$dir" && ./config.sh remove --token "$remove_token")
    mv "$dir" "${dir}.retired-$(date +%Y%m%d)"
  else
    note "would stop and uninstall its LaunchAgent, unregister it, and rename ${dir} to ${dir}.retired-$(date +%Y%m%d)"
  fi
done

# ---------------------------------------------------------------------------
say "Runner package ${RUNNER_VERSION}"

CACHE="/var/tmp/pubmax-runner-${RUNNER_VERSION}"
TARBALL="${CACHE}/${RUNNER_TARBALL}"
if [ -f "$TARBALL" ] && [ "$(shasum -a 256 "$TARBALL" | awk '{print $1}')" = "$RUNNER_SHA256" ]; then
  note "${TARBALL} present and verified"
else
  change sudo mkdir -p "$CACHE"
  change sudo curl -fsSL -o "$TARBALL" "$RUNNER_URL"
  if [ "$APPLY" -eq 1 ]; then
    actual="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
    [ "$actual" = "$RUNNER_SHA256" ] || {
      sudo rm -f "$TARBALL"
      die "checksum mismatch for ${RUNNER_TARBALL}: got ${actual}"
    }
    note "sha256 ${RUNNER_SHA256} verified"
  else
    note "would verify sha256 ${RUNNER_SHA256}"
  fi
fi
change sudo chmod 755 "$CACHE"
change sudo chmod 644 "$TARBALL"

# ---------------------------------------------------------------------------
registered_names="$(gh api "repos/${REPO}/actions/runners" --paginate --jq '.runners[].name')"

for spec in "${RUNNERS[@]}"; do
  IFS=: read -r name user label default_port <<<"$spec"
  say "Runner ${name} as ${user} (${label})"
  dir="/Users/${user}/actions-runner-${name#karan-mac-}"
  # Keep the port this runner already has, else the retired runner's, else
  # the default, so a second --apply never moves a port.
  port="$(root_read sed -n 's/^PW_PORT=\([0-9][0-9]*\)$/\1/p' "$dir/.env" | head -n 1 || true)"
  [ -n "$port" ] || port="$(old_port "$name")"
  port="${port:-$default_port}"
  as_user=(sudo -u "$user" env -i "HOME=/Users/${user}" "PATH=${RUNNER_PATH}" "LANG=en_GB.UTF-8")

  if root_read test -f "$dir/.runner" && grep -qx "$name" <<<"$registered_names"; then
    note "${dir} is configured and ${name} is registered"
  else
    change sudo -u "$user" mkdir -p "$dir"
    change sudo -u "$user" tar -xzf "$TARBALL" -C "$dir"
    if [ "$APPLY" -eq 1 ]; then
      token="$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq .token)"
      "${as_user[@]}" sh -c 'cd "$1" && shift && exec ./config.sh "$@"' sh "$dir" --unattended --replace \
        --url "https://github.com/${REPO}" --token "$token" \
        --name "$name" --labels "$label" --work _work
    else
      note "would register ${name} with labels self-hosted,macOS,ARM64,${label}"
    fi
  fi

  # The runner service reads .path for its PATH and .env for job variables.
  change sudo -u "$user" sh -c "printf '%s\n' '${RUNNER_PATH}' > '${dir}/.path'"
  change sudo -u "$user" sh -c "grep -v '^PW_PORT=' '${dir}/.env' 2>/dev/null > '${dir}/.env.next' || true; printf 'PW_PORT=%s\n' '${port}' >> '${dir}/.env.next'; mv '${dir}/.env.next' '${dir}/.env'"
  change sudo -u "$user" mkdir -p "/Users/${user}/Library/Logs/$(label_for "$name")"

  plist="$(plist_for "$name")"
  service="$(label_for "$name")"
  plist_body="$(
    cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${service}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${dir}/runsvc.sh</string>
    </array>
    <key>UserName</key>
    <string>${user}</string>
    <key>GroupName</key>
    <string>${user}</string>
    <key>WorkingDirectory</key>
    <string>${dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/${user}/Library/Logs/${service}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/${user}/Library/Logs/${service}/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>ACTIONS_RUNNER_SVC</key>
      <string>1</string>
      <key>HOME</key>
      <string>/Users/${user}</string>
    </dict>
    <key>SessionCreate</key>
    <true/>
  </dict>
</plist>
PLIST
  )"
  if [ -f "$plist" ] && [ "$(cat "$plist")" = "$plist_body" ]; then
    note "${plist} is current"
  else
    if [ "$APPLY" -eq 1 ]; then
      printf '%s\n' "$plist_body" | sudo tee "$plist" >/dev/null
      sudo chown root:wheel "$plist"
      sudo chmod 644 "$plist"
      note "wrote ${plist}"
    else
      note "would write ${plist} (UserName ${user}, runsvc.sh in ${dir})"
    fi
  fi
  if root_read launchctl print "system/${service}" >/dev/null 2>&1; then
    change sudo launchctl kickstart -k "system/${service}"
  else
    change sudo launchctl bootstrap system "$plist"
  fi
done

# ---------------------------------------------------------------------------
say "Prove it"

if [ "$APPLY" -eq 0 ]; then
  note "dry run: nothing changed. Run again with --apply."
  exit 0
fi

failed=0
for user in "$PR_USER" "$PRIVILEGED_USER"; do
  # The console user reads the check and the runner user runs it, which is the
  # point: the runner user cannot open the repository in the locked home.
  # shellcheck disable=SC2024
  if sudo -u "$user" bash -s <"${SCRIPT_DIR}/assert-runner-identity.sh"; then
    note "${user}: identity check passed"
  else
    note "${user}: identity check FAILED"
    failed=1
  fi
  for secret in "$CONSOLE_HOME/.ssh" "$CONSOLE_HOME/.config/gh" "$CONSOLE_HOME/.gitconfig"; do
    if sudo -u "$user" test -r "$secret"; then
      note "${user} can still read ${secret}"
      failed=1
    fi
  done
done
if sudo -u "$PRIVILEGED_USER" ls "/Users/${PR_USER}" >/dev/null 2>&1 || sudo -u "$PR_USER" ls "/Users/${PRIVILEGED_USER}" >/dev/null 2>&1; then
  note "${PR_USER} and ${PRIVILEGED_USER} can read each other's homes"
  failed=1
fi

sleep 10
listeners="$(ps -axo user=,command= | awk '/Runner\.Listener/ && !/awk/ {print $1}' | sort | uniq -c)"
note "Runner.Listener processes by user:"
printf '%s\n' "$listeners" | sed 's/^/     /'
if printf '%s\n' "$listeners" | awk '{print $2}' | grep -qx "$CONSOLE_USER"; then
  note "a Runner.Listener still runs as ${CONSOLE_USER}"
  failed=1
fi

note "GitHub's view:"
gh api "repos/${REPO}/actions/runners" --paginate \
  --jq '.runners[] | "     \(.name)  \(.status)  \([.labels[].name] | join(","))"'

if [ "$failed" -ne 0 ]; then
  die "one or more checks failed; see above and the rollback in docs/CI_RUNBOOK.md"
fi
say "Done. Rerun the open pull requests' checks; each job's 'Refuse the console user' step now passes."
