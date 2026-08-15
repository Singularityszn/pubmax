# Contribution Impact Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a credited Pubmaxxer one direct path from a successful Pint Price receipt to their existing contribution impact.

**Architecture:** A small shared link component owns the profile anchor and one privacy-safe analytics event. The successful credited receipt renders that link. `YourContributionsCard` owns the destination anchor in every loading, degraded, empty, and ready state.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript, Vitest, Playwright.

**Spec:** `/Users/karanmanoharan/Documents/pubmaxxing-cheapestpint-research-live/outputs/deep_competitive_findings.md`

## Global Constraints

- Reward mapping impact, never alcohol quantity.
- Show the link only after server-confirmed credited attribution.
- Route to `/u/{handle}#your-contributions`, not the public volume leaderboard.
- Keep loading and degraded profile reads distinct from zero contributions.
- Emit one closed analytics event with no handle, Venue, Pint Price, or free text.
- Keep the receipt's map-reach statement unchanged.

---

### Task 1: Pin link, destination, and analytics contract

**Files:**
- Create: `__tests__/contributionImpactReturn.test.ts`
- Modify: `__tests__/analyticsEvents.test.ts`

**Interfaces:**
- Consumes: `ContributionImpactLink`, `YourContributionsCard`, and `sanitizeEvent`.
- Produces: exact href, exact destination anchor, and zero-prop event contract.

- [x] **Step 1: Write failing tests**

  Render the link for `night_owl`, render the contribution card's loading state, and assert `contribution_impact_opened` sanitizes to an empty property object.

- [x] **Step 2: Run tests to verify RED**

  Run: `npm test -- __tests__/contributionImpactReturn.test.ts __tests__/analyticsEvents.test.ts`

  Expected: FAIL because the link and event do not exist.

### Task 2: Close the successful receipt loop

**Files:**
- Create: `components/profile/ContributionImpactLink.tsx`
- Modify: `components/map/VenuePriceSubmit.tsx`
- Modify: `components/map/venuePriceSubmit.css`
- Modify: `components/profile/YourContributionsCard.tsx`
- Modify: `lib/analyticsEvents.ts`
- Modify: `e2e/price-submission.spec.ts`

**Interfaces:**
- Consumes: credited `CommunityPriceAttribution.handle`.
- Produces: a 44 px `See your impact` link and `id="your-contributions"` destination.

- [x] **Step 1: Implement minimal link and anchor**

  Link only inside the credited receipt branch. On click, call `trackEvent("contribution_impact_opened")`. Add the destination ID to every `YourContributionsCard` section state.

- [x] **Step 2: Run unit tests to verify GREEN**

  Run: `npm test -- __tests__/contributionImpactReturn.test.ts __tests__/analyticsEvents.test.ts`

  Expected: PASS.

- [x] **Step 3: Extend browser receipt proof**

  Assert the signed price receipt exposes `See your impact`, exact profile fragment href, and a 44 px target.

- [x] **Step 4: Run focused browser and quality gates**

  Run: `PW_SKIP_WEBSERVER=1 PW_PORT=3110 npx playwright test e2e/price-submission.spec.ts --project=chromium --grep "credited handle" --workers=1`

  Run focused Vitest, ESLint, TypeScript, and `git diff --check`.

  Expected: all pass.
