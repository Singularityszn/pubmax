# Task 5 report: Social Crew authority handoff

## Status

Fix Round 1 complete. Independent verifier returned `VERDICT: PASS`.

Review base: `807ed503 fix: certify Social Crew mutation handlers`.

## Fix Round 1

### Stable denial replay

Stored write failures now replay their original deterministic response for the
same actor, operation, key, and digest. Successful receipts retain the existing
`replayed` success code. A changed digest still returns
`idempotency_conflict`.

RED: same-digest replay returned `{ ok: false, code: "replayed" }` instead of
the stored `not_found` denial.

GREEN: the PostgreSQL 16 migration test proves original denial replay, changed
digest conflict, and unchanged successful replay semantics.

### Atomic legacy Plan metadata

Legacy Plan status and context changes now use one service-only RPC. It locks
the Plan first, hides Crew-bound Plans, verifies the legacy host token, checks
the transition against locked status, and writes status and context in the same
transaction. TypeScript no longer uses a pre-read plus direct Plan update.

RED: PostgreSQL reported the new function was absent. The TypeScript boundary
test then showed no RPC call. A direct NULL-token case later returned `ok` due
to SQL three-valued comparison.

GREEN: host, guest, NULL-token, invalid-transition, and Crew-bound cases pass.
Both race schedules pass without deadlock: conversion-first makes the metadata
write return `not_found`; metadata-first commits metadata before conversion.
Rollback restores the exact pre-0075 function and grant catalog.

### Membership authority revision

First activation and reactivation now increment `authority_revision` once when
membership changes to active. Existing active membership and idempotent replay
do not increment it. Invitation and Join Request acceptance retain their Crew
lock before membership work.

RED: double invitation acceptance created one member but left revision at 1
instead of 2. Reactivation later left revision at 3 instead of 4.

GREEN: invitation and Join Request double-acceptance races each activate one
member and increment once. A reactivation race accepts both an invitation and a
Join Request into one retained Plan member, increments once, and exact replay
leaves revision unchanged.

## Verification

```text
npx vitest run __tests__/socialCrewRoutes.test.ts __tests__/socialCrewStore.test.ts __tests__/socialRelationships.test.ts __tests__/socialCrewLegacyPlanBoundary.test.ts __tests__/socialCrewMigration.test.ts __tests__/writeSurfaceCertification.test.ts --maxWorkers=1
```

Result: 6 files and 155 tests passed.

```text
npm run test:rls
```

Result: 1 file and 36 tests passed, including exact rollback catalog proof.

```text
npm run typecheck
npm run lint
```

Result: TypeScript passed. ESLint exited 0 with 33 existing warnings outside
owned files. Focused lint for all owned TypeScript files passed cleanly.

No hosted migration, push, or deployment performed.

## Deferred

- Nested invitation and Join Request routes still do not bind child IDs to the
  parent Crew path. Fix belongs to the route follow-up, not this migration fix.
- Existing structural `server-only` boundary and header-order proof gaps remain
  deferred as recorded in the Slice 1 ledger.
