# Coverage Demand Missions Implementation Plan

**Goal:** Convert existing unsupported-area signals into a privacy-safe coverage mission queue.

**Architecture:** Extend the existing store contract with one summary read shared by memory and Supabase. Add a moderator-only route. Mount a small queue component in the existing admin tabs.

**Spec:** `docs/specs/2026-08-15-coverage-demand-missions.md`

## Constraints

- No migration. Use the existing `area_demand` table.
- No email or coordinates in selected fields, DTOs, responses, or UI.
- No new auth path. Use `isModerator` and the existing admin session.
- Keep area-demand aggregation in the store, not the route or component.
- Do not add more responsibilities to `AdminClient` than tab composition.

### Task 1: Summary store contract

**Files:**

- Modify: `lib/areaDemandStore.ts`
- Modify: `__tests__/areaDemandStore.test.ts`

- [x] Write failing memory aggregation tests.
- [x] Add `AreaDemandSummary`, `AreaDemandSummaryResult`, and bounded options.
- [x] Aggregate by normalised area plus matched patch.
- [x] Add a field-limited Supabase read and test both backends.
- [x] Run `npm test -- __tests__/areaDemandStore.test.ts`.

### Task 2: Moderator route

**Files:**

- Create: `app/api/admin/area-demand/route.ts`
- Create: `__tests__/adminAreaDemandRoute.test.ts`

- [x] Write failing access and response tests.
- [x] Parse bounded `limit` and `sinceDays` query values.
- [x] Require moderator access and return `jsonNoStore`.
- [x] Assert response contains no email or coordinate fields.
- [x] Run `npm test -- __tests__/adminAreaDemandRoute.test.ts`.

### Task 3: Admin mission queue

**Files:**

- Create: `app/admin/CoverageDemandQueue.tsx`
- Modify: `app/admin/AdminClient.tsx`
- Create: `__tests__/adminAreaDemandSurface.test.ts`

- [x] Write a failing rendered surface contract.
- [x] Add `Coverage demand` tab composition only to `AdminClient`.
- [x] Render ranked responsive cards with distinct loading, empty, denied, failed, and partial states.
- [x] Keep PII field names out of the component.
- [x] Run focused store, route, surface, voice, lint, and TypeScript checks.
