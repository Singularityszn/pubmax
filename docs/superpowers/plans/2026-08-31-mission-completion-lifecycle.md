# Mission Completion Lifecycle Plan

**Goal:** Remove a completed mission from active ranking without removing its
authoritative receipt or mixing it into the next Venue.

**Architecture:** `VenuePriceSubmit` emits one mission-only completion signal
after a confirmed success. `usePriceEvidenceMission` excludes the completed
Venue for the current mounted surface and reranks remaining Venue IDs. Map keeps
its keyed composer mounted. Near holds the completed mission subtree while the
receipt is visible.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom.

## Constraints

- Keep Pint Drop `onLogged` separate from mission completion.
- Never complete a failed or contribution-gated mission.
- Do not emit `mission_dismissed` for completion.
- Do not write completion into session dismissal storage.
- Keep the earned receipt visible after reranking.
- Never show one Venue's receipt under another Venue.

### Task 1: Add the completion boundary

**Files:**

- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/nearme/usePriceEvidenceMission.ts`
- Modify: `__tests__/venuePriceSubmitRefresh.test.tsx`
- Create: `__tests__/priceEvidenceMissionCompletion.test.tsx`

- [x] Prove only authoritative mission success emits completion.
- [x] Add the separate mission completion callback.
- [x] Exclude a completed Venue from the hook's next bounded request.
- [x] Prove completion emits no dismissal event and writes no session state.

### Task 2: Preserve the receipt on both surfaces

**Files:**

- Modify: `components/nearme/NearPriceEvidenceMission.tsx`
- Modify: `components/nearme/PriceEvidenceMissionSlot.tsx`
- Modify: `components/map/inspector/VenueSheetPriceEntry.tsx`
- Modify: `components/map/inspector/VenuePriceEntryPanel.tsx`
- Modify: `__tests__/priceEvidenceMissionCompletion.test.tsx`

- [x] Near retains the completed Venue form and receipt while reranking.
- [x] Near hides stale mission controls after completion.
- [x] Map removes the mission banner without remounting the Venue form.
- [x] A later Venue never inherits the prior Venue receipt or opened state.

### Task 3: Verify and ship

- [x] Run focused tests, targeted ESLint, scoped TypeScript, and diff check.
- [x] Get independent reviews.
- [ ] Commit, push, and confirm the remote branch SHA.
