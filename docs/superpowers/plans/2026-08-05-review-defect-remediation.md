# Review defect remediation plan

> **For Sol 5.6 high:** Execute each task in order. Every implementation task begins with a failing test and ends with focused plus repository verification.

**Goal:** Resolve confirmed Greptile P1 findings that still reproduce on current `main`, while preserving the existing product truth and accessibility contracts. Record unconfirmed bloat and deferred architecture work as a separate Sol-ready specification and ticket proposal.

**Architecture:** Keep policy in existing domain modules. `lib/routeMiniMap.ts` owns pure mini-map geometry and stop identity helpers. Night copy remains in `components/night/NightModeCard.tsx`; coverage wording remains in `components/night/NightAreaCoverage.tsx` with a pure exported formatter for deterministic tests. No new compatibility layer or duplicate store is introduced.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, ESLint.

**Global constraints:** Do not edit skill-pack churn or generated datasets. Preserve the dirty worktree. Do not use em dashes. Treat reviewer comments as hypotheses until current code and a regression test confirm them. Keep map geometry and trust copy honest: routed geometry must include its detours, straight-line distance must be labeled, and a coverage row must not turn non-price evidence into a price claim.

## Task 1: Reproduce and lock mini-map stale-state defects

**Files:** `lib/routeMiniMap.ts`, `__tests__/routeMiniMap.test.ts`, `components/plan/PlanRouteMiniMap.tsx`

1. Add failing pure tests for a stop signature that changes when a venue name changes, and for bounds that contain routed vertices outside the stop extent. Run `npx vitest run __tests__/routeMiniMap.test.ts` and confirm red.
2. Add the smallest helpers needed to produce a name-aware stop key and merge stop plus route coordinates for bounds. Update the component to clear old state when a new stop set starts loading, depend on names as well as IDs, and fit the merged geometry.
3. Run the focused suite and `npm run typecheck`. Refactor only after tests pass; remove stale comments that describe the old state behavior.

## Task 2: Correct night coverage and ending copy

**Files:** `components/night/NightAreaCoverage.tsx`, `components/night/NightModeCard.tsx`, `__tests__/nightAreaCoverage.test.ts`, `__tests__/nightModeCard.test.ts`

1. Add failing tests for coverage detail derived from a non-price missing-evidence entry, and for leave-by plus straight-line copy. Run both focused suites and confirm red.
2. Export pure copy/coverage helpers, make the coverage sentence describe open checks rather than price checks, and label the live value as leave-by time. Restore the straight-line qualifier for haversine distance.
3. Run focused tests, voice compliance tests, and lint on changed files. Keep jokes and provenance boundaries unchanged.

## Task 3: Verify remaining high-risk review findings before implementation

**Files:** current route/store modules and their existing tests only when a finding reproduces

1. Inspect the current implementations for identity, rate-limit, freshness, alias, and moderation findings from PRs 464-511.
2. For each confirmed defect, add one failing outer-surface test first, run it red, then implement the narrow fix. Skip findings already fixed or contradicted by current contracts and record the reason in the audit log.
3. Run the affected suites and capture exact command results. Do not batch unrelated refactors into this wave.

## Task 4: Produce Sol-ready bloat specification and ticket proposal

**Files:** `docs/specs/2026-08-05-review-bloat-and-store-dedupe.md`, `docs/tickets/2026-08-05-review-bloat-tickets.md`

1. Use current code and issue #168 as evidence for store-factory duplication, repeated runtime data readers, and review-only intermediary artifacts.
2. Write a test-seam-first specification with non-goals, rollout, rollback, and measurable acceptance criteria.
3. Draft dependency-ordered vertical tickets with explicit blocking edges. Present the proposal for Sol review before publishing child tickets; do not start this architecture work in the defect wave.

## Task 5: Verification and closeout

1. Restore dependencies with `npm ci --ignore-scripts` only if the lockfile matches and the missing modules are confirmed as an environment issue.
2. Run focused tests, `npm run lint`, `npm run typecheck`, `npm test`, and the applicable data/audit gates. Use an isolated build directory for production verification.
3. Re-run the code-review checklist on the final diff, check all changed comments for WHY-only content, and record unresolved findings with evidence rather than suppressing them.
