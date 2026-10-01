# PR #1881 scoped main delta review

Compared `af5a08f78afad1091efc7ed97d1906daf9b47db1` with merge `f33f77e42b8a045695529ec87f2ed1b6ed4cb719`, limited to package scripts, Knip, scripts rules, `docs/VOICE.md`, and the new `scripts/chatgpt-map` package. The Core checkout was at `5de246205d8ff0fd1d601c94f3a73639476a3db1` during review.

## Core overlap

The current Core candidate changes `package.json` and the root `package-lock.json` within this scope. PR #1881 changes `package.json` scripts, but leaves the root lockfile and root dependency declarations unchanged from `af5`.

Compose the `package.json` changes. Keep Core's `test:disposable-plan-db` command and dependency updates. Add `test:chatgpt-map` to the existing `verify` sequence. The new script runs `npm ci` in `scripts/chatgpt-map` on every invocation, so each `verify` includes a nested install step and writes nested `node_modules`. The nested lock is separate from Core's root lock changes.

The current candidate has no edits to `knip.config.ts`, `scripts/AGENTS.md`, `docs/VOICE.md`, or `docs/rules/scripts-ci-gates-and-audits.md`. No direct overlap appeared in those files.

## Knip and rules

`knip.config.ts` skips nested `node_modules` when it discovers `.mjs` and `.d.mts` pairs. It then gives the root and `scripts/chatgpt-map` separate Knip workspaces. The root keeps its existing entry and ignore lists. The nested package scans its `.mjs` project and enters its test files. This matches the new package boundary at source level.

The scripts rule moves runner ownership to `docs/CI_RUNBOOK.md` and updates the linked title while preserving the existing anchor. The Knip rule now documents the nested package and its ignored root-tool dependencies. `scripts/AGENTS.md` updates its matching title. These links remain consistent in the diff. Runtime Knip validation was not run.

## MCP helper boundary

The new package pins its MCP SDK dependencies in its own lockfile and declares Node `>=22.12.0`. `public-venues.mjs` accepts an exact London borough and a limit from 1 to 30. It projects public venue, listed-price, publisher, and canonical map-link fields from `public/data/pint_prices_app_dataset.json`. It does not accept account or friend-location input.

`server.mjs` exposes a stateless MCP endpoint and a widget resource on loopback. It checks Host and Origin, bounds request bodies, and reads no account state. Unit tests use the official local MCP client. The separate browser proof uses a controlled host and root Playwright. The nested test command does not run that proof. Neither proves an authenticated ChatGPT connection or production-host compatibility.

The `docs/VOICE.md` change distinguishes a missing publisher label from a recorded label whose URL cannot be linked safely. The widget follows those states in its publisher disclosure code. No browser or ChatGPT-host run was performed for this review.

## Evidence boundary

This receipt records source comparison only. No dependencies were installed, and no tests, lint, Knip, builds, browser runs, or live ChatGPT checks were run. The current Core candidate and PR #1881 changes were not merged or applied here.
