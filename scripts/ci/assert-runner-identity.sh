#!/usr/bin/env bash
# Retired 4 October 2026. CI runs on GitHub-hosted ubuntu-latest.
# The console-user check only applied to the Mac runners.
echo "assert-runner-identity: retired. Workflows run on GitHub-hosted ubuntu-latest. See docs/CI_RUNBOOK.md." >&2
exit 1

# Refuse to run a job as the person at the keyboard.
#
# The self-hosted pubmax-mac runners execute branch code and every dependency
# the lockfile names. Run as the Mac's login user, that code can read ~/.ssh,
# the gh token and every key file in the home directory, and can overwrite the
# Homebrew binaries later jobs reuse. scripts/ci/setup-dedicated-runner-user.sh
# moves the runners to dedicated non-admin users; this check is the tripwire
# that turns a runner which drifted back into a red job.
#
# It fails when the job user:
#   1. is the console (logged-in) user,
#   2. is a member of the admin group, or
#   3. can list the console user's home directory.
#
# The setup script runs this same file as each runner user to prove the move.
set -euo pipefail

fail() {
  echo "::error title=Runner identity::$1" >&2
  echo "See docs/CI_RUNBOOK.md, section 'Dedicated runner users'." >&2
  exit 1
}

if [ "$(uname -s)" != "Darwin" ]; then
  fail "expected a macOS self-hosted runner, got $(uname -s)"
fi

job_user="$(id -un)"
console_user="$(stat -f %Su /dev/console)"

echo "job user: ${job_user}; console user: ${console_user}"

if [ "$job_user" = "root" ]; then
  fail "the job runs as root"
fi

if [ "$job_user" = "$console_user" ]; then
  fail "the job runs as the console user ${console_user}"
fi

if id -Gn "$job_user" | tr ' ' '\n' | grep -qx admin; then
  fail "the job user ${job_user} is a member of the admin group"
fi

# At the login window the console user is root, which has no home to protect.
if [ "$console_user" != "root" ]; then
  console_home="$(dscl . -read "/Users/${console_user}" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
  if [ -z "$console_home" ]; then
    fail "cannot resolve the home directory of console user ${console_user}"
  fi
  if ls "$console_home" >/dev/null 2>&1; then
    fail "the job user ${job_user} can list ${console_home}"
  fi
fi

echo "Runner identity OK: ${job_user} is not the console user, not an admin, and cannot read ${console_user}'s home."
