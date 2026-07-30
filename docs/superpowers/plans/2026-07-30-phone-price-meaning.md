# Phone Price Meaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make map price data understandable from the phone filter sheet while making selected and unavailable Tonight Arc controls self-evident.

**Architecture:** `MobilePriceChoices` will keep deriving `MapPriceLegendModel` through `mapPriceLegend`, but delegate all legend rendering to existing `MapKey`. `ZonePintIndexStrip` will expose one compact method note whose claims match `computeZonePintIndex`. `TonightArcChips` will add non-colour selected and unavailable cues without changing filter behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, local component CSS.

## Global Constraints

- Do not edit `components/map/DrinkShapeChips.tsx`, drink glyph component, or `components/PubMap.tsx`.
- Do not add another legend, colour list, filter behavior change, or price calculation change.
- Run each acceptance check against current code and observe expected failure before implementation.
- Prove phone behavior at 390px and 430px.
- Keep CSS changes minimal and local.
- Commit each coherent piece.

---

### Task 1: Reuse MapKey in MobilePriceChoices

**Files:**
- Modify: `__tests__/mobilePriceChoices.test.ts`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `components/map/MobilePriceChoices.tsx`
- Modify: `components/mobile/mobileMapShell.css`

**Interfaces:**
- Consumes: `MapKey({ legend: MapPriceLegendModel })` and `mapPriceLegend(context)`
- Produces: phone filter sheet containing `aria-label="Map key"` and rows from derived legend

- [ ] **Step 1: Write failing rendered tests**

Render `MobilePriceChoices` with a sparse `MapRenderedState`. Assert `MapKey` markup is present, only derived rows appear, and old `mobilePriceBandLegend` markup is absent. Add Playwright coverage opening Prices and places at 390px and 430px, then assert Map key visibility and displayed derived rows.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/mobilePriceChoices.test.ts`

Run: `npx playwright test e2e/drink-chip-controls.spec.ts --grep "map key"`

Expected: unit test fails because no `.mapKey` exists; browser test fails because phone sheet has no `Map key`.

- [ ] **Step 3: Render existing MapKey**

Import `MapKey` in `MobilePriceChoices` and replace the custom legend section with `<MapKey legend={legend} />`. Remove obsolete `mobilePriceBandLegend` rules only.

- [ ] **Step 4: Verify green**

Re-run both commands. Expected: PASS.

- [ ] **Step 5: Commit**

Commit component, tests, and removed obsolete CSS together.

### Task 2: State Zone Pint Index meaning and basis

**Files:**
- Modify: `__tests__/zonePintIndexStrip.test.ts`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `components/zones/ZonePintIndexStrip.tsx`
- Modify: `components/zones/zonePintIndex.css`

**Interfaces:**
- Consumes: `ZonePintIndex`, `MIN_PRICED_VENUES`, and guarantees from `computeZonePintIndex`
- Produces: compact sheet note describing median, cheapest recorded pint per pub, nearest-station zone assignment, and ten-pub publication floor without a recency claim

- [ ] **Step 1: Write failing rendered tests**

Render compact `ZonePintIndexStrip` and assert visible method copy identifies median, each pub's cheapest recorded pint, nearest-station TfL zone assignment, and `MIN_PRICED_VENUES`. Add phone sheet assertion for same note.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/zonePintIndexStrip.test.ts`

Run: `npx playwright test e2e/drink-chip-controls.spec.ts --grep "zone figures"`

Expected: FAIL because compact mode suppresses method copy.

- [ ] **Step 3: Add truthful compact basis**

Render concise method copy in compact mode. Reuse existing `.zonePintIndexMethod` styling with one compact size adjustment if needed. Do not state freshness or currency.

- [ ] **Step 4: Verify green**

Re-run both commands. Expected: PASS.

- [ ] **Step 5: Commit**

Commit component, tests, and local CSS together. Commit message names `computeZonePintIndex` as basis.

### Task 3: Make Tonight Arc state readable without colour

**Files:**
- Modify: `__tests__/mapExperienceLensUi.test.ts`
- Modify: `e2e/drink-chip-controls.spec.ts`
- Modify: `components/map/TonightArcChips.tsx`
- Modify: `components/map/tonightArcChips.css`

**Interfaces:**
- Consumes: existing `visibility` booleans and disabled Clubs declaration
- Produces: visible selected mark for active chips and visible `Wave 2` reason for disabled Clubs

- [ ] **Step 1: Write failing rendered tests**

Assert active chip contains a non-colour selected mark, inactive chip does not, and Clubs carries visible unavailable reason. Add 390px Playwright assertions using computed styles plus DOM cues.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- __tests__/mapExperienceLensUi.test.ts`

Run: `npx playwright test e2e/drink-chip-controls.spec.ts --grep "Tonight Arc"`

Expected: FAIL because selection depends on fill and Clubs reason exists only in `title`.

- [ ] **Step 3: Add direct control cues**

Render a compact check mark only for selected chips. Render `Wave 2` inside disabled Clubs and provide an accessible unavailable label. Add only local alignment rules needed at phone width.

- [ ] **Step 4: Verify green and inspect real pages**

Re-run both commands. Open `/map` in Chrome at 390x844 and 430x932, inspect Prices and places, compare active and inactive Tonight Arc chips, and confirm Clubs reason is visible.

- [ ] **Step 5: Commit**

Commit component, tests, and local CSS together.

### Task 4: Closeout verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed three commits
- Produces: clean validation evidence

- [ ] **Step 1: Run focused tests**

Run all new unit and Playwright checks together.

- [ ] **Step 2: Run project gates**

Run `npm run lint`, `npm run typecheck`, and relevant test files. Then run `npm run verify`.

- [ ] **Step 3: Review**

Inspect `git diff` and commit history. Confirm no edits to prohibited files, no second legend or colour list, no generated-file churn, and clean worktree.

