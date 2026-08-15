# Governed Night Area Landing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish price-first Night Area pages only where PUBMAXX has enough current, publisher-backed Venue Dataset evidence.

**Architecture:** Assign each pub to at most one containing Night Area by nearest centre. A pure model publishes only route-ready areas with at least 10 exact cheapest-pint rows that name a publisher. Server pages, metadata, JSON-LD, and sitemap consume that same model, so thin or stale areas cannot appear through a second path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright.

**Spec:** `/Users/karanmanoharan/Documents/pubmaxxing-cheapestpint-research-live/outputs/deep_competitive_findings.md`

## Global Constraints

- Use Night Area and Venue Dataset language from `CONTEXT.md`.
- Assign one Venue to the nearest Night Area centre only when it is inside that area's radius.
- Publish only areas that pass `isNightAreaRouteReady` at build time.
- Require at least 10 publisher-backed exact cheapest-pint rows.
- Name publisher beside every visible Pint Price.
- Show Venue Dataset collection date once, not as a per-row observation date.
- Use stable Venue IDs for Ledger and map links.
- Do not mix community prices into this static acquisition lane.

---

### Task 1: Governed Night Area model

**Files:**
- Create: `lib/nightAreaLanding.ts`
- Create: `__tests__/nightAreaLanding.test.ts`

**Interfaces:**
- Consumes: `NightArea`, `isNightAreaRouteReady`, `Venue`, `haversineKm`, `namedLegacyPintPriceSource`, and `PINT_DATASET_OBSERVED_AT`.
- Produces: `assignVenueToNightArea(venue, areas)`, `buildNightAreaLandingModels(venues, options)`, `buildNightAreaLandingModel(slug, venues, options)`, and `NightAreaLandingModel`.

- [x] **Step 1: Write failing assignment and publication tests**

  Pin one nearest-containing assignment, outside-radius exclusion, route-ready refusal, 10-row floor, exact source requirement, cheapest-first order, stable tie-break, row cap, and one collection label.

- [x] **Step 2: Run test to verify RED**

  Run: `npm test -- __tests__/nightAreaLanding.test.ts`

  Expected: FAIL because `@/lib/nightAreaLanding` does not exist.

- [x] **Step 3: Implement pure model**

  Use `haversineKm([venue.longitude, venue.latitude], [area.centre.lng, area.centre.lat])`. Keep candidates within `area.radiusKm`, sort by distance then area slug, and return one area. Build publisher-backed rows from the exact `venue.cheapestPrice` row only.

- [x] **Step 4: Run test to verify GREEN**

  Run: `npm test -- __tests__/nightAreaLanding.test.ts`

  Expected: PASS.

### Task 2: Public route and structured answer

**Files:**
- Create: `components/areas/NightAreaLandingContent.tsx`
- Create: `app/area/[slug]/page.tsx`
- Create: `app/area/[slug]/area-landing.css`
- Create: `__tests__/nightAreaLandingPage.test.ts`

**Interfaces:**
- Consumes: `NightAreaLandingModel` and `loadGroupedVenues()`.
- Produces: `/area/{slug}` pages, canonical metadata, `BreadcrumbList`, and `ItemList` JSON-LD.

- [x] **Step 1: Write failing page contract tests**

  Assert price-first heading, total, one collection label, named source links, canonical Ledger links, area map link, and factual JSON-LD.

- [x] **Step 2: Run test to verify RED**

  Run: `npm test -- __tests__/nightAreaLandingPage.test.ts`

  Expected: FAIL because page and content modules do not exist.

- [x] **Step 3: Implement minimal server page and mobile-first list**

  Render 10 rows. Use `/map?q={area name}` for discovery and `/ledger/{venueId}` for each stable Venue destination. Return `notFound()` for any ungoverned slug.

- [x] **Step 4: Run page tests to verify GREEN**

  Run: `npm test -- __tests__/nightAreaLandingPage.test.ts __tests__/nightAreaLanding.test.ts`

  Expected: PASS.

### Task 3: Sitemap discovery

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `__tests__/sitemap.test.ts`
- Create: `lib/pintPriceDatasetFile.mjs`
- Create: `lib/pintPriceDatasetFile.d.mts`
- Modify: `lib/dataFreshness.ts`
- Modify: `lib/venueIndexTracing.mjs`
- Modify: `__tests__/venueIndexTracing.test.ts`

**Interfaces:**
- Consumes: `buildNightAreaLandingModels(venues)`.
- Produces: one query-free `/area/{slug}` sitemap entry for every currently publishable model.

- [x] **Step 1: Add failing sitemap family assertions**

  Derive expected area count from the same public model and assert exact family count, no duplicates, and no thin area URLs.

- [x] **Step 2: Run test to verify RED**

  Run: `npm test -- __tests__/sitemap.test.ts`

  Expected: FAIL because no `/area/` entries exist.

- [x] **Step 3: Add model-derived sitemap entries**

  Use Venue Dataset file mtime for `lastModified`, weekly change frequency, and priority `0.7`.

- [x] **Step 4: Run sitemap test to verify GREEN**

  Run: `npm test -- __tests__/sitemap.test.ts`

  Expected: PASS.

- [x] **Step 5: Trace the runtime Venue Dataset into every reader route**

  Promote the dataset filename and include path to one JavaScript owner, declare `lib/venueDataset.ts` as a runtime data pack, remove its pending exception, and assert that `/area/[slug]`, `/drink/[category]`, and `/pint-index` ship the file.

### Task 4: Browser proof and closeout

**Files:**
- Create: `e2e/night-area-landing.spec.ts`
- Create: `docs/proof/night-area-landing/clapham-390-light.png`
- Create: `docs/proof/night-area-landing/clapham-390-dark.png`

**Interfaces:**
- Consumes: published `/area/clapham` route.
- Produces: phone geometry, provenance, keyboard, and 404 proof.

- [x] **Step 1: Add browser contract**

  Assert 200 for Clapham, 10 ranked rows, 10 named publishers, one collection date, no horizontal overflow, 44 px actions, and 404 for an unpublished area.

- [x] **Step 2: Run focused Playwright**

  Run: `PW_SKIP_WEBSERVER=1 PW_PORT=3110 npx playwright test e2e/night-area-landing.spec.ts --project=chromium --workers=1`

  Expected: PASS.

- [x] **Step 3: Capture and inspect light and dark proof**

  Confirm no tab-bar obstruction at page end, no publisher truncation, readable price hierarchy, and no console errors.

- [x] **Step 4: Run quality gates**

  Run focused Vitest, ESLint on changed TypeScript, `npx tsc --noEmit`, `git diff --check`, and focused Playwright.

  Expected: all pass.
