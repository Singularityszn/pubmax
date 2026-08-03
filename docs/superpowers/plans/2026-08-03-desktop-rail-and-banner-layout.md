# Desktop Rail And Banner Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep desktop map chrome outside open planner rail and prevent eligible first-load banners from colliding.

**Architecture:** Publish planner rail's measured rendered width once at desktop drawer breakpoint, then use that value to bound and centre toolbar and ambient banners in remaining map lane. Preserve each banner's eligibility and dismissal lifecycle while giving higher-priority location prompt its existing slot and moving status out of the central prompt lane.

**Tech Stack:** Next.js 16, React 19, CSS, Playwright, Vitest, TypeScript.

## Global Constraints

- Start from `origin/fm/desktop-rail-and-banners-resume`.
- Bugs only. No new features or unrelated restyling.
- Prove both broken states in real desktop browser before production edits.
- Regression coverage asserts rendered boxes and edges and must fail on `origin/main`.
- Commit before and after screenshots beside each other.
- `npx tsc --noEmit` must report zero errors.
- Full unit suite must report at least 7447 passing tests.
- Do not touch sibling lane files named in task brief.

---

### Task 1: Reproduce And Measure Broken Geometry

**Files:**
- Inspect: `app/globals.css`
- Inspect: `components/map/mapToolbar.css`
- Inspect: `components/map/mapBannerStaging.css`
- Replace evidence: `docs/evidence/desktop-rail-and-banners/d1-search-under-rail-before.png`
- Replace evidence: `docs/evidence/desktop-rail-and-banners/d1-search-under-rail-before-detail.png`
- Replace evidence: `docs/evidence/desktop-rail-and-banners/d2-banner-stack-before.png`
- Replace evidence: `docs/evidence/desktop-rail-and-banners/d2-banner-stack-before-detail.png`

**Interfaces:**
- Consumes: rendered `.mapDrawer.left.open`, `.mapToolbar`, `.citySuggestBanner`, and `.cityStatusStack` boxes.
- Produces: literal measured geometry for regression expectations and CSS sizing.

- [ ] **Step 1: Free Playwright port and launch current broken branch**

Run `lsof -tiTCP:3100 -sTCP:LISTEN`, stop any returned process, then run `npm run dev -- --port 3000`.

- [ ] **Step 2: Reproduce planner overlap**

Use a 1440 by 900 desktop browser, open `/map` as a returning visitor, open planner, and record rail, toolbar, search input, and clear-control boxes.

- [ ] **Step 3: Verify rail width**

Derive width from `getBoundingClientRect()` for `.mapDrawer.left.open`. Use measured value, not draft constant.

- [ ] **Step 4: Reproduce first-run banner collision**

Open a fresh browser context with relevant local and session storage empty. Record location and status banner boxes and capture screenshots.

- [ ] **Step 5: Commit reproducible before evidence and plan**

Commit only plan plus four before screenshots. Exclude `probe-scratch.mjs` and tooling artifacts.

### Task 2: Add Red-Capable Desktop Geometry Regression

**Files:**
- Create: `e2e/desktop-map-chrome-fit.spec.ts`

**Interfaces:**
- Consumes: real `/map` DOM geometry across desktop viewports.
- Produces: D1 assertion that toolbar/search clear planner's right edge and D2 assertion that first-run banners do not overlap.

- [ ] **Step 1: Write D1 failing test**

Open planner, read rendered rail and toolbar/search boxes, and assert each relevant left edge is at least rail's right edge plus intended gutter.

- [ ] **Step 2: Write D2 failing test**

Start with empty first-run storage, wait for eligible location and status banners, and assert their boxes occupy separate horizontal lanes while both remain visible.

- [ ] **Step 3: Run against broken CSS**

Run `npx playwright test e2e/desktop-map-chrome-fit.spec.ts --project=chromium --workers=1`. Confirm both tests fail on exact measured edge or overlap assertions.

- [ ] **Step 4: Commit red-capable tests**

Commit E2E file after recording expected failures.

### Task 3: Apply Minimal CSS Fixes

**Files:**
- Modify: `app/globals.css`
- Modify: `components/map/mapToolbar.css`
- Modify: `components/map/mapBannerStaging.css`

**Interfaces:**
- Consumes: measured planner width and existing `planning-open`, `detail-open`, and banner roots.
- Produces: planner-aware map lane and non-overlapping banner staging without changing eligibility.

- [ ] **Step 1: Publish measured planner width**

At desktop drawer breakpoint, set `--desktop-planner-rail-width` to measured width and apply it to `.mapDrawer.left`.

- [ ] **Step 2: Move and bound toolbar**

Mirror right-drawer free-lane arithmetic for `.appShell.planning-open .mapToolbar`; hide only duplicate accessories and allow search descendants to shrink.

- [ ] **Step 3: Move and bound ambient banners beside planner**

Apply same remaining-lane centre and maximum width to desktop status and city-suggest banners while planner is open.

- [ ] **Step 4: Make lower first-run banner yield spatially**

When city-suggest prompt is present, move status into a separate desktop lane. Keep both mounted and usable.

- [ ] **Step 5: Run focused E2E green**

Run `npx playwright test e2e/desktop-map-chrome-fit.spec.ts --project=chromium --workers=1` and confirm both tests pass.

- [ ] **Step 6: Commit implementation**

Commit CSS changes as one coherent bug fix.

### Task 4: Capture After Evidence And Verify

**Files:**
- Create: `docs/evidence/desktop-rail-and-banners/d1-search-under-rail-after.png`
- Create: `docs/evidence/desktop-rail-and-banners/d1-search-under-rail-after-detail.png`
- Create: `docs/evidence/desktop-rail-and-banners/d2-banner-stack-after.png`
- Create: `docs/evidence/desktop-rail-and-banners/d2-banner-stack-after-detail.png`
- Delete: `probe-scratch.mjs`

**Interfaces:**
- Consumes: fixed rendered layout.
- Produces: committed visual proof and clean source tree.

- [ ] **Step 1: Capture fixed states**

Repeat exact 1440 by 900 scenarios used for before evidence and save after screenshots.

- [ ] **Step 2: Confirm test fails on main and passes on fix**

Run same E2E test against `origin/main`, restore branch, then rerun against fixed branch.

- [ ] **Step 3: Run required validation**

Run `npx tsc --noEmit`, full `npm test`, and focused E2E. Confirm zero TypeScript errors and at least 7447 unit tests.

- [ ] **Step 4: Clean tooling churn and inspect diff**

Restore `next-env.d.ts` if changed, remove scratch probe, verify `node_modules` is not staged, run project AGENTS upkeep script, and inspect status/diff.

- [ ] **Step 5: Replace WIP history and commit evidence**

Commit after screenshots and cleanup, then rewrite branch commits so no WIP commit message remains.

- [ ] **Step 6: Independent verification**

Run check-work verifier, address any findings, and rerun required checks before completion status.
