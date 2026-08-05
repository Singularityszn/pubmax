# Task 2 report: product identity and adult-verification policy

## Status

Round 1 review findings resolved. Original implementation commit `731d2a0b`
and corrective implementation commit `736aee1f` now provide the five-state
Social access policy, protected product-account ownership, dual-session account
migration, legacy-handle provenance, private assurance evidence storage, and
exact Social API middleware scope.

Social remains preview-only by default. Yoti integration is not active. This
task ships only the service-only evidence schema and fail-closed policy that a
future authenticated provider integration may populate.

## Architecture

- `lib/socialAccess.ts` owns the pure `preview`, `sign_in_required`,
  `age_verification_required`, `verified`, and `suspended` states. A stored
  evidence row can satisfy `verified` only when it belongs to the current
  product account, has the expected provider and decision, is current, is not
  future-dated, and has not expired.
- `lib/socialAccessServer.ts` owns Clerk session verification, private account
  reads, the beta write policy, and the service-role migration RPC. Identity or
  storage uncertainty fails closed.
- `POST /api/social/access` owns dual-session migration because this protected
  route is the one request boundary where both independent authorities can be
  proven. The route derives the Supabase identity with
  `verifyCallerAuth(request)`. Clerk middleware context is verified separately
  in the server policy seam. No handle, email, account ID, or other ownership
  proxy is accepted from the body. Only those server-derived identifiers reach
  the transactional RPC.
- Migration `0071` adds service-only product ownership, audit, and minimal
  Yoti-shaped evidence tables. It also gives `profiles` durable
  `account_link_state` provenance: pre-migration unlinked rows become
  `legacy_unlinked`, recognised new `ensure` rows are `ephemeral`, and completed
  links become `account_owned`.
- `proxy.ts` matches only `/api/social/:path*`. Half-configured Clerk still uses
  the plain security proxy. `lib/clerkIdentity.ts` remains untouched because PR
  #726 owns it.

## Round 1 findings resolved

1. Legal and report language now says Yoti processing is deferred. Privacy and
   terms describe only current service-only evidence fields and the conditional
   data practice if provider integration is enabled later. They no longer claim
   a hosted check, callback, or result is operating.
2. Account migration returns `SOCIAL_BETA_DISABLED` with status 403 while the
   invite beta is off. The policy returns before Clerk verification or the
   migration store call.
3. Established `ensure()` then `linkUser()` flows work again. Durable provenance
   freezes pre-0071 legacy rows without treating newly created ephemeral rows as
   legacy. Memory and Supabase paths share the same state transitions. All
   previously failing profile deletion, redaction, and visibility callers pass.
4. `migrate_social_product_account` sorts both advisory identity locks by key
   and every involved product-account row by UUID before locking. The real
   PostgreSQL regression launches 12 synchronized psql clients, alternates both
   crossed mappings, performs 20 calls per transaction, and verifies the two
   original bindings remain unchanged without deadlock or timeout.
5. Memory handle claims reconstruct ownership from the durable profile row after
   alias-cache loss. Retrying the same owner and handle remains idempotent.

## TDD evidence

Red evidence captured before each correction:

- Baseline `npm test`: 13 failures across five files. Two write-surface
  certification failures plus 11 profile/redaction/visibility failures exposed
  the blanket existing-row refusal.
- Profile regression set: 7 failures across four files, including the missing
  legacy fixture seam, broken ensure-then-link behavior, and alias-cache-loss
  retry.
- Beta policy test called identity dependencies instead of returning the
  required preview refusal. Route test passed a `Request` rather than explicit
  verified authority. Certification reported the new route uncovered and the
  inventory off by one.
- Migration provenance tests failed because `account_link_state` did not exist.
- Deployed PostgreSQL function-definition assertion failed because neither
  advisory nor account-row lock acquisition had a declared sorted order.
- Legal test failed on the live claims that Yoti ran a hosted adult check and
  returned a result.
- Self-review parity test failed because memory onboarding still reported a
  newly ensured ephemeral handle as taken.

Green evidence:

- Profile and ownership first cycle: 60/60 passed.
- Route, beta policy, and write certification: 19/19 passed.
- Legal pages: 23/23 passed.
- PostgreSQL forward, provenance, account migration, crossed concurrency,
  private grants, assurance shape, and rollback: 8/8 passed.
- Broad focused regression set covering every baseline failing file and Social
  policy surfaces: 160/160 passed across 14 files.
- Post-review memory/Supabase parity set: 42/42 passed across four files.

## Final verification

- `npm test`: 762/762 files and 7,727/7,727 tests passed, 0 failures, 198.45s.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0 with 0 errors. Twenty-nine repository warnings
  outside this task remain; this task introduces none.
- `git diff --check`: exit 0.
- Shape review: one durable provenance owner replaces the blanket refusal;
  memory and SQL transitions agree.
- Diff review: no stale first-touch implementation path, no uncertified Social
  mutation route, and no Yoti hosted-processing claim remains.
- Docs review: write-surface inventory is 75, Social authority stance is
  certified, privacy and terms match current behavior, and this report records
  deferred provider integration explicitly.

## Migration note

Captain applies migrations. This task did not apply SQL to production. Suffix
`0071` remains reserved here because PR #726 owns `0070`; Task 3 owns `0072`.
Rollback removes Task 2 private state and profile provenance, then restores the
prior handle-claim function.

## Concerns and follow-on boundary

- No Yoti hosted-session, result, or webhook endpoint exists. A later provider
  integration needs an official signed fixture, authenticated server results,
  replay deduplication, product-account binding, and the same no-document,
  no-selfie, no-DOB, no-estimated-age, no-raw-payload storage boundary.
- Social beta remains off by default. Missing or half-configured Clerk and
  missing private storage cannot open Social content or account migration.
- Migration `0071` must land before code that writes `account_link_state` is
  enabled against durable storage.
