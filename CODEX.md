# Codex handoff

This repository is public. Keep this handoff limited to durable project facts.
Never record local filesystem paths, credential locations, private infrastructure,
account billing details, unpublished deployment commands, or temporary worker state
here.

## Start here

1. Read [`AGENTS.md`](AGENTS.md) and the nearest area `AGENTS.md` before editing.
2. Read [`CONTEXT.md`](CONTEXT.md) and the relevant ADR or specification.
3. Read [`docs/agents/build-methodology.md`](docs/agents/build-methodology.md).
4. Query GitHub directly for current issues, pull requests, checks, and review state.
5. Compare the deployed `/api/version` response with current `origin/main` before
   making any production claim.

Live state changes too quickly for a committed handoff to be authoritative. A pull
request body, review, or check result is evidence only for the recorded commit.

## Release boundaries

- `npm run verify` is the local merge bar. Report every failure and distinguish a
  branch regression from a reproduced failure on current main.
- GitHub checks that did not start because of account or spending limits are not
  green checks.
- A successful build or deploy gate is not a production deployment.
- Only the captain applies migrations or authorises a production deploy.
- Never fetch a harvested URL without `lib/harvest/sourcePolicy.ts` and the
  applicable robots decision. A manual request does not turn a refused source into
  an allowed source.
- Commits carry no agent trailer or session link.
- Preserve unrelated worktrees and uncommitted changes.

## Audit snapshot from 22 September 2026

This section records safety decisions from the audit that replaced the original
session handoff. Check GitHub for newer facts before acting.

- PR #1747 is held. Its dataset contains non-price prose, category errors, and
  venues outside London.
- PR #1756 is held. It contains fixture URLs in publishable data, fetches
  unapproved redirects, and can misstate undated or retrospective Reddit text as
  current community evidence.
- PR #1774 is the corrective successor to #1764. It preserves #1764's user-facing
  `/soft-drinks-and-water` zero-sugar cola family chip, Pepsi Max/Diet Pepsi tabs,
  and responsive UI coverage while withdrawing refused Nicholson menu rows and
  enforcing source and provenance checks. Do not merge #1764 separately or restore
  refused rows. #1774 remains draft and needs current review and gates.
- PR #1741's behaviour review was clean, but its source commits violate commit
  history rules. Use a clean replacement branch.
- PR #1773 must prove production-only telemetry. `NODE_ENV=production` and
  `VERCEL=1` also describe Vercel preview builds, so production scope must use the
  deployment environment explicitly. The Speed Insights script must not mount on
  a private or dynamic route before event filtering runs.

No item above is merge approval. Each branch still needs its own current review,
tests, and evidence.

## Current-state commands

Use the repository's documented `gh-axi` wrapper for GitHub reads and writes. The
issue tracker contract lives in [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
Standard project commands live in [`README.md`](README.md) and `package.json`.

Do not copy machine-specific commands, tokens, host paths, or private fleet notes
into this file. Keep operational handoffs in the authorised private operator
workspace.
