# Mission Evidence Receipt Implementation Plan

**Goal:** Never show a successful evidence receipt unless the price-submit
response contains one valid authoritative price, and show a failed mission
attempt as a failed receipt without losing the form.

**Architecture:** `useCommunityPrices` owns response validation and optimistic
rollback. `VenuePriceSubmit` owns user feedback and funnel events. Existing
mission receipt helpers own the closed receipt outcomes and copy.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom.

## Constraints

- Preserve Venue, drink category, mission reason, typed price, and return
  surface after failure.
- A malformed `2xx` response is not success.
- A valid row for another Venue, drink, or penny value is not success.
- Failure emits no `price_submitted`, no `mission_newly_trusted`, and no
  `onLogged` callback.
- Mission analytics carry no Venue ID, handle, price, or coordinates.
- Venue-signal submission behavior does not change.

### Task 1: Fail closed on malformed price success

**Files:**

- Modify: `components/map/useCommunityPrices.ts`
- Modify: `app/api/price-submit/route.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Create: `__tests__/useCommunityPricesSubmit.test.tsx`

- [x] Add a jsdom hook harness that returns a `2xx` payload without a valid
  `price` and proves the optimistic row is rolled back.
- [x] Run the focused test and confirm RED.
- [x] Return a rejected result with honest confirmation copy when the stored
  price cannot be parsed.
- [x] Preserve supported Venue aliases through an explicit canonical write
  target in the authoritative response.
- [x] Run the focused test and confirm GREEN.

### Task 2: Add failed mission receipt

**Files:**

- Modify: `lib/priceEvidenceMissions.ts`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `__tests__/priceEvidenceMissions.test.ts`
- Modify: `__tests__/venuePriceSubmitRefresh.test.tsx`
- Modify: `lib/analyticsEvents.ts`
- Modify: `__tests__/analyticsEvents.test.ts`
- Modify: `docs/METRICS_FUNNEL.md`

- [x] Add `failed` to the closed receipt outcome and pin its copy.
- [x] Prove a failed mission keeps typed input, reports failure, emits only
  failure funnel events, and never calls `onLogged`.
- [x] Implement the smallest state and rendering change.
- [x] Record the privacy-safe failed mission funnel outcome.
- [x] Run focused tests and confirm GREEN.

### Task 3: Verify and ship

- [x] Run focused tests, targeted ESLint with zero errors, a scoped TypeScript
  check, and `git diff --check`.
- [x] Get independent code and UI contract reviews.
- [ ] Commit, push, and confirm the remote branch SHA.
