# Governed Brand by Night Area Pint Landings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish governed brand-by-Night-Area Pint Price answers and connect every exact ranked row to its Venue-bound contribution flow.

**Architecture:** Extend existing drink-brand selection owner, then add one pure pair-governance module and one server loader consumed by route, metadata, JSON-LD, static params, and sitemap. Render one server component with no new client state. Existing Map query and price-submission owners handle contribution.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript, Vitest, Playwright, CSS.

**Spec:** `specs/governed-brand-area-pint-landings.md`

## Global Constraints

- Use only `public/data/pint_prices_app_dataset.json` through `loadPintPriceLandingVenues()`.
- Publish only route-ready Night Areas with at least 10 unique matching pub Venues.
- Render at most 20 ranked rows, but report full eligible Venue count.
- Publisher belongs to exact displayed row. Missing status is `Publisher not recorded`.
- Shared collection date is not live or per-row freshness.
- No competitor content or data enters storage, display, or ranking.
- No new client component, external request, migration, or storage.
- No em dash or exclamation mark in visible copy.

---

### Task 1: Pure pair-governance model

**Files:**
- Modify: `lib/drinkBrandLanding.ts`
- Create: `lib/drinkBrandAreaLanding.ts`
- Create: `__tests__/drinkBrandAreaLanding.test.ts`

**Interfaces:**
- Consumes: `DRINK_BRANDS.beer`, `assignVenueToNightArea`, `isNightAreaRouteReady`, `PINT_DATASET_OBSERVED_AT`, `isPubVenueKind`.
- Produces: `selectDrinkBrandPriceForVenue`, `buildDrinkBrandAreaLanding`, `listDrinkBrandAreaLandings`, and spec types/constants.

- [ ] **Step 1: Write failing pure model tests**

Use literal fixtures. Prove unknown pair refusal, route gate refusal, floor 9 refusal, floor 10 publication, one nearest-area assignment, exact cheapest brand row selection, non-pub and invalid-price exclusion, deterministic ties, 20-row cap, full count, shared date, and exact publisher. Add one real-dataset assertion for ordered eligible pair ids and counts on 2026-08-15.

- [ ] **Step 2: Run RED**

```bash
npx vitest run __tests__/drinkBrandAreaLanding.test.ts
```

Expected: fail because module and exported selector do not exist.

- [ ] **Step 3: Implement minimal pure model**

Export exact-row selector from `lib/drinkBrandLanding.ts`. Make London brand and pair builders consume it. Add pair builder/list functions with spec signatures. Never mutate Venue-owned arrays.

- [ ] **Step 4: Run GREEN and regression**

```bash
npx vitest run __tests__/drinkBrandAreaLanding.test.ts __tests__/drinkBrandLanding.test.ts __tests__/nightAreaLanding.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/drinkBrandLanding.ts lib/drinkBrandAreaLanding.ts __tests__/drinkBrandAreaLanding.test.ts
git commit -m "feat: govern brand area pint landings"
```

### Task 2: Server loader, route, metadata, and JSON-LD

**Files:**
- Create: `lib/drinkBrandAreaLanding.server.ts`
- Create: `components/drinks/DrinkBrandAreaLandingContent.tsx`
- Create: `app/area/[slug]/drink/[brand]/page.tsx`
- Create: `app/area/[slug]/drink/[brand]/drink-area.css`
- Create: `__tests__/drinkBrandAreaLandingPage.test.ts`

**Interfaces:**
- Consumes: Task 1 model and `loadPintPriceLandingVenues()`.
- Produces: `loadDrinkBrandAreaLandings`, `loadDrinkBrandAreaLanding`, `drinkBrandAreaLandingJsonLd`, static params, metadata, and rendered page.

- [ ] **Step 1: Write failing page tests**

Test real server rendering for one eligible pair. Assert H1, cheapest price, exact publisher, shared date, one primary area-and-brand Map URL, exact Venue Ledger links, and one exact `sel` plus `log=1` contribution URL per row. Assert static params equal loader output, invalid pairs 404/noindex, canonical/Open Graph metadata, and BreadcrumbList plus rendered ItemList JSON-LD.

- [ ] **Step 2: Run RED**

```bash
npx vitest run __tests__/drinkBrandAreaLandingPage.test.ts
```

Expected: fail because server loader, component, and route do not exist.

- [ ] **Step 3: Implement minimal server page**

Keep page server-rendered. Encode query values with `URLSearchParams`. Use one primary hero action and put `Log this price` beside each exact row. Use semantic ordered-list markup and existing PUBMAXX tokens.

- [ ] **Step 4: Run GREEN and voice gates**

```bash
npx vitest run __tests__/drinkBrandAreaLandingPage.test.ts __tests__/frictionVoice.test.ts __tests__/emDashLaw.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/drinkBrandAreaLanding.server.ts components/drinks/DrinkBrandAreaLandingContent.tsx 'app/area/[slug]/drink/[brand]' __tests__/drinkBrandAreaLandingPage.test.ts
git commit -m "feat: publish brand area pint pages"
```

### Task 3: Sitemap ownership

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: `loadDrinkBrandAreaLandings()` from Task 2.
- Produces: one sitemap entry per eligible pair.

- [ ] **Step 1: Add failing sitemap behavior test**

Assert each loader pair appears exactly once at `/area/<areaSlug>/drink/<brandSlug>`, uses Pint Price mtime, weekly frequency, and priority 0.75. Stub empty pair loader and assert no pair URL appears.

- [ ] **Step 2: Run RED**

```bash
npx vitest run __tests__/sitemap.test.ts
```

Expected: fail because sitemap does not enumerate pair loader.

- [ ] **Step 3: Add pair loader to existing parallel read**

Import loader, add it to current `Promise.all`, and append encoded governed pair entries after separate area and brand entries. Do not hardcode pair count.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run __tests__/sitemap.test.ts __tests__/drinkBrandAreaLandingPage.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/sitemap.ts __tests__/sitemap.test.ts
git commit -m "feat: index governed brand area pages"
```

### Task 4: Phone and desktop journey proof

**Files:**
- Create: `e2e/drink-brand-area-landing.spec.ts`
- Modify: `app/area/[slug]/drink/[brand]/drink-area.css` only when browser geometry requires it.

**Interfaces:**
- Consumes: Task 2 route.
- Produces: browser proof for answer, exact actions, accessibility, and responsive layout.

- [ ] **Step 1: Write browser test before CSS adjustment**

At 320, 390, 430, and desktop, assert H1 and cheapest answer above fold, no horizontal overflow, non-decreasing prices, primary and row log actions at least 44 by 44 CSS pixels, exact URLs, and visible focus. Cover light and dark modes across matrix.

- [ ] **Step 2: Run browser RED or baseline**

```bash
CI=1 NODE_OPTIONS=--max-old-space-size=4096 PW_PORT=35141 PW_NEXT_DIST_DIR=.next-brand-area-proof npx playwright test e2e/drink-brand-area-landing.spec.ts --project=chromium --workers=1
```

Expected: new route assertions fail before Task 2 exists, or geometry failures identify exact CSS corrections after Task 2.

- [ ] **Step 3: Apply minimal responsive corrections**

Keep one-column phone rows, preserve price prominence, and keep exact row action inside each row. Do not hide publisher, pint, or action copy at narrow widths.

- [ ] **Step 4: Run browser GREEN and inspect screenshots**

Run Step 2 command. Inspect 320, 390, 430, and desktop screenshots. Reject covered actions, clipped text, horizontal scroll, weak focus, or generic card composition.

- [ ] **Step 5: Commit**

```bash
git add e2e/drink-brand-area-landing.spec.ts 'app/area/[slug]/drink/[brand]/drink-area.css'
git commit -m "test: prove brand area landing journey"
```

### Task 5: Review and final verification

**Files:**
- Modify only files required by concrete review findings.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: reviewed, verified, clean branch.

- [ ] **Step 1: Review shape and contracts**

Check one owner for brand-row selection, pair governance, server loading, route rendering, and sitemap enumeration. Remove duplicate selection, URL, date, or publisher logic found by review.

- [ ] **Step 2: Run focused checks**

```bash
npx eslint lib/drinkBrandLanding.ts lib/drinkBrandAreaLanding.ts lib/drinkBrandAreaLanding.server.ts components/drinks/DrinkBrandAreaLandingContent.tsx 'app/area/[slug]/drink/[brand]/page.tsx' __tests__/drinkBrandAreaLanding.test.ts __tests__/drinkBrandAreaLandingPage.test.ts e2e/drink-brand-area-landing.spec.ts
npm run typecheck
git diff --check
```

- [ ] **Step 3: Run full gate**

```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run verify
```

- [ ] **Step 4: Re-run exact browser gate**

Use Task 4 command. Confirm tracked proof files and generated Next config files remain clean.

- [ ] **Step 5: Clean tooling churn and commit fixes**

Restore only `next-env.d.ts` or `tsconfig.json` changes created by Next tooling, then commit concrete review fixes. Finish with clean `git status --short`.

## Self-review

- Spec coverage: each publication, route, UI, SEO, contribution, and proof rule maps to Tasks 1-4.
- Placeholder scan: no deferred implementation behavior remains.
- Type consistency: Task 2 consumes Task 1 model names. Task 3 consumes Task 2 loader. Task 4 consumes Task 2 route.
- Scope: one additive route family and exact-row acquisition-to-contribution journey. Price watches and OCR remain separate features.
