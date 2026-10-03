#!/usr/bin/env bash
# Run one command with GH_TOKEN as git's GitHub credential, and write it nowhere.
#
# Every checkout sets `persist-credentials: false`, so the job token is never
# saved into .git/config on the runner's disk. The refresh workflows still need
# to push a review branch, so this hands the token to git through the
# GIT_CONFIG_* environment of this one process tree. It ends with the command.
#
# Usage: scripts/ci/with-git-token.sh <command> [args...]
set -euo pipefail

if [ -z "${GH_TOKEN:-}" ]; then
  echo "with-git-token: GH_TOKEN is not set" >&2
  exit 1
fi
if [ "$#" -eq 0 ]; then
  echo "usage: scripts/ci/with-git-token.sh <command> [args...]" >&2
  exit 2
fi

basic="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::${basic}"
fi

export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic ${basic}"

exec "$@"
