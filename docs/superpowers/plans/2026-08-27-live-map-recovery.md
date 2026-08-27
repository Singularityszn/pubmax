# Live Map Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development for every behaviour change. Execute each task in order and review after each green test.

**Goal:** Make the mobile Map calm on first use and make deployed UK pub coverage visible and diagnosable without loading 38,215 markers at once.

**Architecture:** Keep curated Venue Dataset and UK Base separate. Keep UK Base viewport streaming. Change the default London camera so it crosses the existing stream gate, publish explicit stream state, and remove duplicate mobile controls from the resting Map.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre, Vitest, Playwright.

**Spec:** `CONTEXT.md`, `docs/prd/UK_MAP_COVERAGE_AND_SEARCH_PRD.md`, `docs/prd/UI_UX_FIX_PRD.md`, and live production evidence from 2026-08-27.

## Global Constraints

- Preserve separate curated and UK Base layers.
- Never put UK Base pubs into price bands, cheapest-pint lists, or Pint Index.
- Keep all phone touch targets at least 44px.
- Keep MapLibre collision handling enabled.
- Keep one primary action per resting phone view.
- Do not touch native-owned paths.
- Do not deploy before PR review and release gates.

---

### Task 1: Load UK Base on normal London entry

**Files:**
- Modify: `lib/cities.ts`
- Test: `__tests__/cityMapCoverage.test.ts`

**Interfaces:**
- Consumes: `UK_BASE_MIN_ZOOM` from `components/map/canvas/buildScene.ts`.
- Produces: London `mapView.zoom >= UK_BASE_MIN_ZOOM`.

- [x] **Step 1: Write failing cross-module contract test**

Add a test that reads London through `getCity("london")` and asserts its default zoom reaches `UK_BASE_MIN_ZOOM`. This catches the production defect where bare `/map` starts below the fetch gate.

- [x] **Step 2: Run test and verify RED**

Run: `npx vitest run __tests__/cityMapCoverage.test.ts`

Expected: FAIL because London starts at `11.5` and UK Base starts at `12`.

- [x] **Step 3: Apply minimal camera fix**

Set London default zoom to `12`. Do not lower the UK Base gate and do not merge datasets.

- [x] **Step 4: Run test and verify GREEN**

Run: `npx vitest run __tests__/cityMapCoverage.test.ts`

- [x] **Step 5: Commit**

Ship in the reviewed Task 1 and Task 2 batch.

### Task 2: Remove duplicate mobile Map creation

**Files:**
- Modify: `components/nav/createFabActions.ts`
- Modify: `components/nav/CreateFab.tsx`
- Test: `__tests__/createFab.test.ts`

**Interfaces:**
- Produces: `createFabAvailableOnPath(pathname: string): boolean`.
- Map keeps `mobilePlanActivation` and Venue Pint Drop entry. Other tab routes keep global Create.

- [x] **Step 1: Write failing render test**

Assert `CreateFab` renders empty markup on `/map` and still renders on `/out`.

- [x] **Step 2: Run test and verify RED**

Run: `npx vitest run __tests__/createFab.test.ts`

- [x] **Step 3: Add path policy and gate**

Return `false` only for `/map`. Keep all existing keyboard and modal rules.

- [x] **Step 4: Run test and verify GREEN**

Run: `npx vitest run __tests__/createFab.test.ts`

- [x] **Step 5: Commit**

Ship in the reviewed Task 1 and Task 2 batch.

### Task 3: Collapse resting Map chrome

**Files:**
- Modify: `lib/mapChromeTiers.ts`
- Modify: `components/mobile/MobileMapShell.tsx`
- Modify: `components/mobile/mobileMapShell.css`
- Modify: `components/PubMap.tsx`
- Test: `__tests__/mapChromeTiers.test.ts`
- Test: `__tests__/mapChromeOneBar.test.ts`
- Test: `__tests__/mapChromeDebris.test.ts`
- Test: `__tests__/mobileChromeFit.test.ts`

**Interfaces:**
- Produces: `buildDrinkLaneChip(label, selected)` returns `null` for default Pints and a labelled control for explicit lenses.
- Keeps TfL content in More → Transit.
- Keeps Near me on Map edge.

- [ ] **Step 1: Write failing drink-lane behaviour test**

Assert default Pints returns no resting chip. Assert an explicit whisky lens returns a chip named `Whisky`.

- [ ] **Step 2: Write failing chrome ownership tests**

Assert Map edge renders Near me only. Assert mobile app attitude control is hidden. Update source contracts so TfL remains available through More → Transit, not as a second floating utility.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run __tests__/mapChromeTiers.test.ts __tests__/mapChromeOneBar.test.ts __tests__/mapChromeDebris.test.ts __tests__/mobileChromeFit.test.ts __tests__/mobileMapPriceChrome.test.ts`

- [ ] **Step 4: Apply minimal component and CSS changes**

Render Map chip row only when an explicit drink lens or a useful Tonight chip exists. Remove TfL from `MapEdgeControls`. Hide `.mapCameraControls` at phone width while preserving MapLibre compass recovery.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same focused Vitest command.

- [ ] **Step 6: Commit**

Commit message: `fix(mobile): calm resting map chrome`

### Task 4: Give First Visit two-layer ownership

**Files:**
- Modify: `components/nav/mobileNav.css`
- Test: `__tests__/mobileMapFirstVisitArrival.test.ts`

**Interfaces:**
- First Visit owns top bar plus arrival card.
- Primary navigation returns after arrival is dismissed or answered.

- [ ] **Step 1: Write failing shipped-style contract**

Assert `.mobileTabBar` is hidden and cannot receive pointer events while `.mapArrivalCard` exists.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run __tests__/mobileMapFirstVisitArrival.test.ts`

- [ ] **Step 3: Add scoped CSS rule**

Hide only phone primary navigation during Map First Visit. Do not change other routes or analytics consent.

- [ ] **Step 4: Run test and verify GREEN**

Run the same focused test.

- [ ] **Step 5: Commit**

Commit message: `fix(mobile): give first visit one clear choice`

### Task 5: Publish honest UK Base stream state

**Files:**
- Modify: `lib/ukBasePubs.ts`
- Modify: `components/map/pubmap/useUkBaseStreaming.ts`
- Modify: `components/PubMapCanvas.tsx`
- Test: `__tests__/ukBasePubs.test.ts`
- Test: `__tests__/ukBaseColdRestore.test.ts`
- Test: `e2e/map-uk-base-layer.spec.ts`

**Interfaces:**
- Produces: `UkBaseStreamStatus = "zoom_required" | "loading" | "ready" | "unavailable" | "suspended"`.
- Produces: `.mapCanvasWrap[data-uk-base-status]` and existing `data-uk-base-count`.
- Manifest or shard failure must not look like a valid empty viewport.

- [ ] **Step 1: Write failing loader result tests**

Assert manifest failure returns `unavailable`. Assert valid empty bounds return `ready` with zero rows. Assert a successful shard returns `ready` with pubs.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run __tests__/ukBasePubs.test.ts __tests__/ukBaseColdRestore.test.ts`

- [ ] **Step 3: Add typed load result**

Change viewport loading to return status beside pubs. Keep cold restore behaviour unchanged.

- [ ] **Step 4: Publish hook state**

Set `zoom_required` below zoom 12, `suspended` during an experience lens, `loading` while viewport request is active, `ready` after a valid result, and `unavailable` after manifest or required shard failure.

- [ ] **Step 5: Run tests and verify GREEN**

Run the focused Vitest command again.

- [ ] **Step 6: Commit**

Commit message: `fix(map): expose UK pub stream state`

### Task 6: Browser proof and PR review

**Files:**
- Evidence only: `.playwright-mcp/`

- [ ] **Step 1: Run focused code checks**

Run focused Vitest files from Tasks 1 to 5, targeted ESLint for changed TypeScript, and `git diff --check`.

- [ ] **Step 2: Test production-like local Map manually**

Use 390x844 and 1440x900. Verify First Visit, resting Map, zoom-12 base load, explicit drink lens, More → Transit, Search, Filters, Near me, Plan, Venue selection, Back, Escape, and focus return.

- [ ] **Step 3: Capture evidence**

Capture mobile initial, mobile resting, mobile base loaded, desktop resting, and one selected UK Base Venue.

- [ ] **Step 4: Review diff**

Review against repository standards and this plan. Resolve all actionable findings.

- [ ] **Step 5: Push PR head**

Push the coherent commits to `codex/v0-recovery`. Do not merge or deploy until review and shared release gates accept the new head.
