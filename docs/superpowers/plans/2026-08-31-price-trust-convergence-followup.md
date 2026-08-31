# Price Trust Convergence Follow-up

**Goal:** Make price trust reconciliation recover from moderation races,
concurrent unlock writers, and branched restore history without exposing stale
account credit.

**Base:** `origin/main` after PR #1289.

**Migration order:** Apply
`20260831120000_0126_price_trust_reconciliation_queue.sql` before
`20260831140000_0128_price_trust_visibility_queue.sql`. Migration 0127 is a
separate reserved lane and is not a dependency of this follow-up.

## Contracts

- Credit becomes visible only after a fresh read proves each stored evidence
  row still exists and is not hidden.
- A visible price correction keeps its historical lifetime unlock. Current
  trusted-now count still follows current price evidence.
- Hidden or missing evidence reverses visible credit and leaves reconciliation
  queued for a later proof pass.
- Competing live events converge on one deterministic event. Each pass reverses
  a bounded number of losers and preserves unfinished work.
- Exact-root reversal traversal follows restored evidence even when the
  observation set changed. Reversed sibling branches do not block the surviving
  lineage.
- Browser roles keep no access to trust events, credits, or reconciliation
  queue state.

## Implemented slices

- [x] Fresh evidence read before `ensureCredits`.
- [x] Stale hide race regression with no visible credit.
- [x] Deterministic multi-event convergence.
- [x] Bounded progress regression for more than one reversal batch.
- [x] Memory and durable exact-root restoration traversal.
- [x] Changed-evidence and reversed-sibling lineage regressions.
- [x] Migration 0128 adds `hidden_at` to the queue trigger and queues legacy
  actor-null price visibility changes.
- [x] Migration 0128 backfills every existing price Venue-category pair.
- [x] Rollback restores the 0126 trigger shape without deleting pending work.

## Verification

- Run the focused trust, moderation, contribution, privacy, and migration suite
  with one Vitest worker.
- Run targeted ESLint with zero warnings.
- Run scoped TypeScript with no emit.
- Run `git diff --check`.
- Obtain two independent P0-P2 reviews of final bytes.

Final local evidence:

- 12 related test files, 141 tests passed with one worker.
- Targeted ESLint passed with zero warnings.
- Scoped TypeScript passed with no emit.
- `git diff --check` passed.
- Two independent reviews returned PASS with no P0-P2 findings.

## Delivery rule

Completed work must be committed and pushed before handoff. Confirm the remote
branch SHA matches local HEAD. Database application, hosted CI, merge, and
production proof remain separate release gates.
