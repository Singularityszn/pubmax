# One-Tap Near Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make homepage "Find my pint" open a nearby cheapest-pint answer without asking for the same action twice.

**Architecture:** Landing uses one permanent primary action and sends an explicit `locate=1` navigation intent to `/near`. `NearPageClient` parses that intent and enables existing `NearMeNow` auto-location. Direct `/near` stays idle, `?patch=` keeps priority, and denied or unavailable location keeps the current remembered-area fallback. Retired landing hierarchy flag and its duplicate browser lane are removed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright.

**Spec:** `/Users/karanmanoharan/Documents/pubmaxxing-cheapestpint-research-live/outputs/deep_competitive_findings.md`

## Global Constraints

- Use PUBMAXX brand language from `CONTEXT.md`.
- Keep direct `/near` idle until the reader explicitly requests location.
- Treat homepage `Find my pint` as explicit location intent.
- Keep `?patch=<id>` above auto-location so shareable area answers never prompt.
- Keep publisher status, collection date, current ranking, and remembered-area fallback unchanged.
- Never add viewer coordinates to the URL, analytics, or persistent storage.

---

### Task 1: One-tap location handoff

**Files:**
- Modify: `components/landing/LandingPage.tsx`
- Modify: `components/nearme/NearPageClient.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/trustedHandoffFlags.ts`
- Modify: `lib/trustedHandoffFlags.server.ts`
- Modify: `playwright.config.ts`
- Test: `__tests__/nearEntry.test.ts`
- Test: `e2e/mobile-landing-entry.spec.ts`

**Interfaces:**
- Consumes: existing `NearMeNow` prop `autoLocate?: boolean`.
- Produces: homepage link `/near?locate=1`; `/near` passes `autoLocate={searchParams.get("locate") === "1"}`.

- [x] **Step 1: Write failing contract and browser tests**

Add a pure query-intent contract test. Add a browser test that grants geolocation, sets a London coordinate, opens `/`, taps the hero `Find my pint` link, and expects `/near?locate=1` plus a ready cheapest-pint answer without a second button click.

- [x] **Step 2: Run contract test to verify RED**

Run: `npm test -- __tests__/nearEntry.test.ts`

Expected: FAIL because explicit location intent has no resolver.

- [x] **Step 3: Implement minimal handoff and permanent hierarchy**

Change every landing `Find my pint` link to `/near?locate=1`. In `NearPageClient`, parse `locate` from `useSearchParams()` and pass `autoLocate={locateParam === "1"}` to `NearMeNow`. Remove old three-button branch and retire `PUBMAX_LANDING_FIND_MY_PINT`. Do not change `NearMeNow` location or fallback logic.

- [x] **Step 4: Run contract and browser tests to verify GREEN**

Run: `npm test -- __tests__/nearEntry.test.ts`

Run: `PW_SKIP_WEBSERVER=1 PW_PORT=3110 npx playwright test e2e/mobile-landing-entry.spec.ts --project=chromium --grep "answers after one homepage tap"`

Expected: PASS with one homepage tap and a rendered answer.

- [x] **Step 5: Preserve entry contracts**

Update existing landing assertions to use current heading and actions. Add browser assertions that direct `/near` still shows the idle `Find my pint` button and `/near?patch=soho&locate=1` answers Soho without requesting geolocation.

- [x] **Step 6: Run focused regression tests**

Run: `npm test -- __tests__/landingFindMyPintHierarchy.test.ts __tests__/nearPriceTrustClient.test.ts __tests__/nearAnalytics.test.ts`

Run: `PW_SKIP_WEBSERVER=1 PW_PORT=3110 npx playwright test e2e/mobile-landing-entry.spec.ts e2e/near-price-trust.spec.ts --project=chromium`

Expected: all focused tests pass.

### Task 2: Mobile proof and review

**Files:**
- Create: `docs/proof/one-tap-near/landing-390.png`
- Create: `docs/proof/one-tap-near/answer-390.png`

**Interfaces:**
- Consumes: completed one-tap entry.
- Produces: light-theme 390 x 844 evidence for entry and ready answer.

- [x] **Step 1: Capture mobile proof**

Open the homepage at 390 x 844, capture the hero, tap `Find my pint`, allow the test coordinate, wait for the ready answer, then capture the destination.

- [x] **Step 2: Inspect rendered geometry**

Confirm no horizontal overflow, primary target is at least 44 x 44 CSS pixels, publisher status wraps without truncation, and no console or page errors appear.

- [x] **Step 3: Run code quality checks**

Run: `npx eslint components/landing/LandingPage.tsx components/nearme/NearPageClient.tsx e2e/mobile-landing-entry.spec.ts`

Run: `npx tsc --noEmit`

Expected: both commands pass.

- [x] **Step 4: Review scope**

Inspect `git diff --check` and the focused diff. Confirm no direct `/near`, patch-link, price-trust, or viewer-coordinate contract changed.
