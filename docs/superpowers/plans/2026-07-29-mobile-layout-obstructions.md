# Mobile Layout Obstructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep fixed mobile controls from obscuring venue-list rows and Plan intake content at 390px and 430px widths.

**Architecture:** Add one focused Playwright regression spec that exercises real hit testing and navigation. Suppress map planner activation while venue list owns map content, then tighten only Plan mobile spacing so first intake action clears fixed navigation without deleting editorial copy.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Playwright.

## Global Constraints

- Keep edits confined to layout, stacking, and browser assertions.
- Do not raise venue-list z-index over planner action.
- Preserve planner reachability after venue list closes.
- Preserve Plan intro copy.
- Run new browser assertions against unfixed code before implementation.
- Cover 390px and 430px widths.

---

### Task 1: Venue-list interaction clearance

**Files:**
- Create: `e2e/mobile-layout-obstructions.spec.ts`
- Modify: `components/mobile/MobileMapShell.tsx`
- Modify: `components/PubMap.tsx`
- Modify: `components/map/mapVenueList.css`

**Interfaces:**
- Consumes: `mapListOpen: boolean` state owned by `PubMap`.
- Produces: `venueListOpen: boolean` prop used by `MobileMapShell` to suppress planner activation.

- [ ] **Step 1: Write failing browser assertions**

Add a 390x844 and 430x932 matrix that opens More map controls, chooses Layers, opens List view, scrolls each row to the panel bottom, checks `document.elementFromPoint()` resolves to that row, and performs a coordinate click that opens the venue sheet. Assert planner activation is absent while list is open, then close list and click planner activation to prove its route remains reachable.

- [ ] **Step 2: Run test against unfixed code**

Run: `npx playwright test e2e/mobile-layout-obstructions.spec.ts --project=chromium`

Expected: FAIL because planner activation owns hit-test points inside venue rows.

- [ ] **Step 3: Implement minimal visibility branch**

Pass `mapListOpen` to `MobileMapShell` as `venueListOpen`; render planner activation only when overlay is closed, planner is closed, and venue list is closed. Correct stale list-layer comment so it no longer claims clearance from planner chip.

- [ ] **Step 4: Run browser assertions**

Run: `npx playwright test e2e/mobile-layout-obstructions.spec.ts --project=chromium`

Expected: venue-list cases PASS at both widths.

- [ ] **Step 5: Commit coherent fix**

Commit message must state planner is suppressed while list is open, closing list restores it, moving it would shrink list, and tests failed before implementation.

### Task 2: Plan opening-screen clearance

**Files:**
- Modify: `e2e/mobile-layout-obstructions.spec.ts`
- Modify: `app/plan/plan.css`

**Interfaces:**
- Consumes: fixed `.mobileTabBar` geometry and first intake heading/action.
- Produces: mobile-only intro spacing where heading and first action remain above fixed navigation at scrollY zero.

- [ ] **Step 1: Write failing browser assertions**

For 390x844 and 430x932, load `/plan` at scrollY zero. Assert first intake heading ends above fixed navigation and `Use my location` is fully inside visible content above navigation.

- [ ] **Step 2: Run test against unfixed code**

Run: `npx playwright test e2e/mobile-layout-obstructions.spec.ts --project=chromium`

Expected: FAIL because heading intersects navigation and first action starts below viewport at 390x844.

- [ ] **Step 3: Implement minimal mobile spacing**

Inside existing `max-width: 760px` block, reduce Plan intro top/bottom margins and mobile display-heading size only enough to expose intake continuation while retaining all copy. Keep page bottom clearance unchanged.

- [ ] **Step 4: Run browser assertions and project checks**

Run:

```bash
npx playwright test e2e/mobile-layout-obstructions.spec.ts --project=chromium
npm run lint
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 5: Commit coherent fix**

Commit Plan spacing and its browser assertions separately from map fix.
