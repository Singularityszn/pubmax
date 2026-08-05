# Task 2 report: product identity and adult-verification policy

## Status

Complete. Commit `731d2a0b` implements the five-state Social access policy,
server-only Clerk/Supabase product ownership, Yoti assurance storage, dual-session
account migration, legacy-handle freeze, private access route, exact Clerk
middleware scope, legal disclosure, and forward/rollback proof.

## Architecture

- `lib/socialAccess.ts` is the pure policy owner. Its only public states are
  `preview`, `sign_in_required`, `age_verification_required`, `verified`, and
  `suspended`. Current Yoti evidence must belong to the same product account,
  be authoritative, non-revoked, started no later than now, and unexpired.
- `lib/socialAccessServer.ts` is the protected server seam. It resolves Clerk
  from `auth()`, reads service-only product and assurance rows, fails storage or
  identity outages closed as `preview` plus a retryable 503, and never exposes a
  product account or verification identifier in route output.
- `POST /api/social/access` owns dual-session migration because the same protected
  boundary already has Clerk middleware context and the Social account policy.
  It derives the Clerk user ID from the active cookie session and the legacy
  Supabase UUID from `verifyCallerAuth(request)` in the same request, then passes
  only those two server-derived IDs to one database transaction. It accepts no
  handle, email, account ID, or other ownership proxy.
- Migration `0071` adds unique Clerk, optional unique Supabase, and unique stable
  profile bindings, ownership state, one-change audit, and minimal Yoti assurance
  rows. All three tables and the migration RPC are service-role only.
- Legacy unlinked handles remain usable only on their old anonymous demo paths.
  Authenticated first touch cannot claim them. New handle creation and already
  linked legitimate ownership remain supported and idempotent. This is enforced
  at route, handle-store, profile-store, and SQL layers.
- `proxy.ts` matches `/api/social/:path*` for Clerk and does not widen middleware
  to unrelated APIs. Half-configured Clerk still uses the plain security proxy.
  `lib/clerkIdentity.ts` was not changed because PR #726 owns it.

## Files

Created:

- `lib/socialAccess.ts`
- `lib/socialAccessServer.ts`
- `app/api/social/access/route.ts`
- `__tests__/socialAccess.test.ts`
- `__tests__/socialAccessServer.test.ts`
- `__tests__/socialAccessRoute.test.ts`
- `__tests__/socialIdentityMigration.test.ts`
- `__tests__/legacyHandleFreeze.test.ts`
- `supabase/migrations/20260805100000_0071_social_identity_assurance.sql`
- `supabase/migrations/rollback/20260805100000_0071_social_identity_assurance_rollback.sql`

Changed narrowly:

- `proxy.ts` and `__tests__/clerkProxyCsp.test.ts`
- `lib/profileOwnership.ts`, `lib/profileStore.ts`, `lib/identityHandleStore.ts`,
  `lib/messageAuth.ts`, and their focused ownership/onboarding tests
- `app/api/profiles/[handle]/route.ts` comments to remove obsolete first-touch
  ownership claims
- `app/privacy/page.tsx`, `app/terms/page.tsx`, and `__tests__/legalPages.test.ts`

## TDD evidence

Red evidence captured before implementation:

- `socialAccess.test.ts`: import failed because `lib/socialAccess.ts` did not exist.
- `socialAccessRoute.test.ts`: import failed because protected route did not exist.
- `socialAccessServer.test.ts`: import failed because server identity seam did not exist.
- `legacyHandleFreeze.test.ts`: existing unlinked handle reported available and
  authenticated first touch linked it.
- `socialIdentityMigration.test.ts`: PostgreSQL failed because migration `0071`
  did not exist.
- `clerkProxyCsp.test.ts`: protected Social API matcher was absent.
- `legalPages.test.ts`: Clerk, Yoti, 18+, cross-provider account IDs, and assurance
  processing were undisclosed.
- `profileOwnershipRoute.test.ts`: low-level store still stamped an existing
  unlinked profile, found during self-review.

Green evidence:

- Social policy/server/route tests: 22 passed.
- Focused ownership/onboarding set: 86 passed after store-level freeze.
- Clerk proxy suite: 36 passed.
- Real PostgreSQL forward/replay/confused-session/handle-freeze/handle-rename/
  private-grant/rollback suite: 6 passed.
- Final focused closeout: 100 passed across 8 files.

## Verification

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm test`: exit 0.
- `git diff --check`: exit 0 before commit.
- Migration proof starts an isolated local PostgreSQL 16 instance, applies
  `0071`, exercises migration and evidence state, applies rollback, verifies new
  objects are gone, then proves the prior legacy claim function works again.

## Migration note

Captain applies migrations. This task did not apply SQL to production. Suffix
`0071` is reserved here because PR #726 owns `0070`; Task 3 owns `0072`.

## Concerns and follow-on boundary

- No Yoti hosted-session, result, or webhook endpoint was invented without an
  official signed fixture. Current code stores and consumes only authoritative
  Yoti-shaped server evidence and otherwise fails closed. A later provider
  integration must authenticate Yoti server results, deduplicate retries, bind
  provider session/reference to the product account, and store no documents,
  selfie, DOB, estimated age, raw payload, or provider token.
- Invite-beta flag remains off by default. Missing or half-configured Clerk and
  missing private storage cannot open Social content.
