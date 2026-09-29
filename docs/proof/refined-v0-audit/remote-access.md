# Refined v0 remote access check

Checked on 29 September 2026 in `codex/refined-v0`. This is an access check, not a repository or browser audit.

Local `HEAD`, `main`, and cached `origin/main` point to `b49b5850010d3cb0f28831cf548488cd1f54240e`. The commit's local record is dated 29 September 2026 at 04:32 BST. No successful remote fetch occurred in this check, so that ref is not proof of the latest GitHub state.

| Check | Observed result |
| --- | --- |
| `command -v gh` | No result. `/opt/homebrew/bin/gh` exists and reports version 2.101.0, but its directory is absent from this process's `PATH`. |
| `gh auth status -h github.com` using the full binary path | Stored default account has an invalid token. |
| `gh-axi repo view Singularityszn/pubmax` with corrected `PATH` | `AUTH_REQUIRED`, exit 1. Fixing `PATH` alone does not restore access. |
| Noninteractive `git ls-remote origin HEAD` | `fatal: unable to get password from user`, exit 128. Origin uses HTTPS. |
| macOS Git credential helper | `osxkeychain` is configured, but Keychain has no internet-password item for `github.com`. |
| Batch SSH authentication to `git@github.com` | `Permission denied (publickey)`, exit 255. |

GitHub access needs a valid credential configured outside this worktree. Until then, recent pushed changes, open pull requests, and remote head cannot be verified. Local code inspection and checks can continue against `b49b5850`; any result must name that commit and keep remote freshness unverified.

This check changed documentation only. No build or test ran: this worktree has no `node_modules` directory, and the access check did not install dependencies. No server or watcher was started.
