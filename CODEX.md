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

## Durable reconciliation

This section records durable release constraints from the audit. Query GitHub for
current review, check, and merge state before acting.

- The zero-sugar cola family UI associated with PR #1764 is carried by corrective
  PR #1774. Release evidence must preserve the `/soft-drinks-and-water` family
  chip, Pepsi Max/Diet Pepsi tabs, and responsive UI coverage while excluding
  refused Nicholson menu rows and enforcing source and provenance checks.

No item above is merge approval. Each branch still needs its own current review,
tests, and evidence.

## Current-state commands

Use the repository's documented `gh-axi` wrapper for GitHub reads and writes. The
issue tracker contract lives in [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
Standard project commands live in [`README.md`](README.md) and `package.json`.

Do not copy machine-specific commands, tokens, host paths, or private fleet notes
into this file. Keep operational handoffs in the authorised private operator
workspace.
