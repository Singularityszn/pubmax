# Price Mission Actor Coverage Plan

**Goal:** Never ask a signed-in contributor to corroborate their own current
price evidence after a remount.

**Architecture:** Add one bounded server-only Community Price coverage read for
the stable profile actor and requested Venue IDs. Ranking excludes only current
covered drink categories. Stale own evidence remains eligible for refresh. A
failed coverage read returns a degraded response with no mission.

**Tech Stack:** Next.js route handlers, TypeScript, in-memory and Supabase
Community Price stores, Vitest.

## Constraints

- Keep actor tokens inside the server store.
- Keep request and response free of coordinates, handles, and prices.
- Preserve the existing eight-Venue request bound.
- Do not turn an actor-covered Venue into a false missing-price mission,
  including when moderation hides the actor's current row.
- Keep another uncovered category at the same Venue eligible.
- Keep stale evidence eligible for a fresh observation.
- Fail closed when actor coverage cannot be read completely.

### Task 1: Prove category-level exclusion

**Files:**

- Modify: `lib/priceEvidenceMissions.ts`
- Modify: `__tests__/priceEvidenceMissions.test.ts`

- [x] Exclude the actor's current covered category.
- [x] Keep another uncovered category eligible.
- [x] Preserve missing and stale decisions.

### Task 2: Add the bounded server-only coverage read

**Files:**

- Modify: `lib/communityPriceStore.ts`
- Create: `__tests__/communityPriceMissionCoverage.test.ts`

- [x] Memory read returns current rows for one actor. Hidden current rows count
  because same-actor resubmission cannot bypass moderation or add independence.
- [x] Durable read uses one bounded actor-and-Venue query.
- [x] Other actors, stale rows, non-submittable categories, and malformed IDs
  do not cover. Current hidden own rows still cover for mission usefulness.
- [x] Store failures return degraded without leaking actor data.

### Task 3: Wire the authenticated route

**Files:**

- Modify: `app/api/price-missions/route.ts`
- Modify: `__tests__/priceEvidenceMissionsRoute.test.ts`

- [x] Pass stable profile actor coverage into ranking.
- [x] A fresh own submission is not offered again after remount.
- [x] Another contributor still receives the useful provisional mission.
- [x] Coverage failure returns degraded with no mission.

### Task 4: Verify and ship

- [x] Run focused tests, targeted ESLint, scoped TypeScript, and diff check.
- [x] Get independent review.
- [ ] Commit, push, and confirm the remote branch SHA.
