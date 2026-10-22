# Issue triage handoff

Branch: codex/issue-triage-reliability
HEAD: 178d5bd69cf588401609844286116ce580175644
Base: c6872e242
Status: combined verification completed with exit 1 at freshness; no push, merge or deployment.

## Commits

- 6ea8b625a043d7e18e71d5f6388d71d5da6de450: fix(map): explain unchecked accessibility results
- 7bfe6f1dc09b7d0f2633b5b5f8ca19a9df096844: fix(nav): preserve query destinations in bounded warm history
- 178d5bd69cf588401609844286116ce580175644: fix: isolate Arize tracing to Node instrumentation

All three commit messages contain subject only, no body or trailers. Author and committer: Karan Manoharan <31683167+karanmrn@users.noreply.github.com>.

## Acceptance and focused evidence

#1639: User approved exact clarification: “Other pubs may qualify; we haven’t checked them yet.” Keep confirmed-access policy strict. Three accessibility facets tested at zero and positive counts. New cases failed before fix; 103 focused venue accessibility/truth tests passed afterwards. Computer Use confirmed desktop copy fits.

#1641: Recover dormant 05fdc824851ec9f72175fa8e58ae69941f960aeb without changing original worktrees. Preserve query destinations in warm history and router prefetch; remove hash only; deduplicate complete destination; cap FIFO history at 128. Recovery retained main deletion of warmMapIntent. 27 focused tests passed. No current measured latency improvement claimed.

Arize: Reproduced keyless webpack development /map HTTP500 from Node-only tracing dependencies being bundled for Edge (Cannot resolve path). Positive NEXT_RUNTIME === nodejs condition around dynamic import fixes compiler boundary; early-return guard did not. Runtime and AST regression tests plus existing Arize tests: 23 passed; focused lint passed. Fresh /map HTTP200; combined Computer Use loaded pub data and pins after matching local data revision.

## Known limits

Computer Use exposed accessibility filtering bypass: slim-pin overrides suppress all three access requirements; UK-base stream is separate. London recovery branch already owns broader fix, handed to coordinating task 01a0c626-dbfd-71d3-9f3d-bc56b9d55922. No duplicate fix here. Required additional coverage: known true/false/unknown for each slim facet, mixed hydrated/slim parity, conjunction, UK-base suspend and cached restore.

Prior isolated full verify: 17387 passed, 1 failed, 1 skipped; failure was revision guard after generated data was restored mid-test. Not a green gate. Combined invocation uses DEPLOYMENT_VERSION=local and preserves generated data until tests finish. Four revision guard tests passed with matching local packs. Full final gate pending.

No claim that all historical tasks, all repo files, native journeys, or production regressions are fully audited.

## Shared gate

Acquire /tmp/pubmax-verify.lock with atomic mkdir, write owner, wait while held, never steal or remove another owner's lock. Release only if owner still equals this process token. Combined log: /tmp/pubmaxx-issue-triage-verify.log.

## Final combined gate

DEPLOYMENT_VERSION=local npm run verify completed exit 1 at freshness. Data validation: 21 datasets passed. Lint: zero errors, 74 warnings. Typecheck and deadcode passed. Coverage: 1630 files passed, one skipped; 17395 tests passed, one skipped (250.80s). RLS: 34 files / 407 tests passed (80.89s). Conditional E2E skip scan: 237 specs passed. This is a static skip scan, not a full browser suite.

Freshness: area_news 599.5h exceeds 504h; night_signal_candidates, weather, whats_on unmeasurable without credentials. Dependency audit was not reached after freshness failure. No thresholds relaxed and no data refreshed to bypass gate.

Mutex: atomically acquired owner 42506 06:29:19 codex-issue-triage-178d5bd69 after prior owner released. During our active run the directory disappeared; unknown external remover. Atomically reacquired the vacant directory with identical owner token while shell remained alive. Cannot claim uninterrupted isolation. Own EXIT trap released lock after completion; final check confirmed directory absent.

Final HEAD unchanged: 178d5bd69cf588401609844286116ce580175644. Tracked working tree clean. Untracked: node_modules symlink and .tmp-evidence/issue-triage/ handoff. Diff from c6872e242: 9 files, 197 insertions, 20 deletions. Dev server stopped before gate. All three commit bodies/trailers empty.

Paths: __tests__/instrumentationRuntimeBoundary.test.ts, __tests__/intentLinkWarming.test.tsx, __tests__/mapWarmup.test.ts, __tests__/venueAccessibility.test.ts, components/nav/IntentLink.tsx, instrumentation.ts, lib/AGENTS.md, lib/mapWarmup.ts, lib/venueAccessibility.ts.
