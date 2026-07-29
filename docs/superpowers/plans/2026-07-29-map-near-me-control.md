# Map Near Me Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep desktop Near me control painted when actionable city status banner arrives.

**Architecture:** Keep existing `CitySuggestBanner` lifecycle and desktop chrome positions. Add behavioural Playwright coverage that supplies deterministic severe city status data, proves location permission remains unrequested, and checks control geometry at narrow and wide desktop widths. Remove only status-to-location suppression selector while preserving onboarding suppression and Tonight banner priority.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS, Playwright, Vitest.

## Global Constraints

- Do not redesign map chrome.
- Do not change map density, clustering, collision padding, symbol layers, keyboard venue list, drawer focus trap, or call-to-action colours.
- Do not change user-facing copy.
- Use one local browser at a time.
- Keep changes limited to location control staging, its tests, and diagnosis evidence.

---

### Task 1: Add Red-Capable Browser Regression

**Files:**
- Create: `e2e/map-near-me.spec.ts`

**Interfaces:**
- Consumes: `/api/citymcp/status`, `.cityStatusBanner`, `.citySuggestBannerSwitch`.
- Produces: Playwright assertion that status banner and attached, on-screen Near me control coexist with geolocation permission still `prompt`.

- [ ] **Step 1: Write failing browser test**

```typescript
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("keeps Near me painted when desktop city status arrives", async ({ page }) => {
  await page.route("**/api/citymcp/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-29T18:00:00.000Z",
        weather: null,
        signals: [],
        tubeLines: [{ line: "Central", status: "Severe delays" }],
      }),
    }),
  );

  for (const width of [800, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/map?near-me-regression=${width}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".cityStatusBanner")).toBeVisible();

    const nearMe = page.getByRole("button", { name: "Near me?", exact: true });
    await expect(nearMe).toHaveCount(1);
    await expect(nearMe).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          navigator.permissions
            .query({ name: "geolocation" })
            .then((permission) => permission.state),
        ),
      )
      .toBe("prompt");

    const bounds = await nearMe.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(
      width,
    );
  }
});
```

- [ ] **Step 2: Run test against current code**

Run:

```bash
PW_PORT=3000 PW_SKIP_WEBSERVER=1 npx playwright test e2e/map-near-me.spec.ts --project=chromium --workers=1
```

Expected: FAIL at `toBeVisible()` because control stays attached but status staging gives ancestor `display: none`.

- [ ] **Step 3: Commit red regression**

```bash
git add e2e/map-near-me.spec.ts docs/superpowers/plans/2026-07-29-map-near-me-control.md
git commit -m "test(map): reproduce missing Near me control"
```

### Task 2: Preserve Location Control Through Status Arrival

**Files:**
- Modify: `components/map/mapBannerStaging.css`
- Modify: `__tests__/mapBannerStagingCss.test.ts`

**Interfaces:**
- Consumes: existing banner sibling presence and fixed desktop vertical slots.
- Produces: status banner may continue hiding Tonight lane, while city suggestion remains independently visible and keeps Tonight lane hidden.

- [ ] **Step 1: Update staging policy test**

Replace closure priority expectation with assertions that closure still hides Tonight, closure does not hide city suggestion, and city suggestion still hides Tonight:

```typescript
it("keeps location available while status and Tonight remain staged", () => {
  expect(css).toMatch(
    /\.mapStage:has\(\.cityStatusBanner\)\s+\.tonightLaneCollapsed/,
  );
  expect(css).not.toMatch(
    /\.mapStage:has\(\.cityStatusBanner\)\s+\.citySuggestBanner/,
  );
  expect(css).toMatch(
    /\.mapStage:has\(\.citySuggestBanner\)\s+\.tonightLaneCollapsed/,
  );
});
```

- [ ] **Step 2: Remove only status-to-location suppression**

Change priority cascade to:

```css
.mapStage:has(.cityStatusBanner) .tonightLaneCollapsed,
.mapStage:has(.citySuggestBanner) .tonightLaneCollapsed {
  display: none;
}
```

Update comments to state status and location use their existing separate vertical slots while Tonight remains staged below both.

- [ ] **Step 3: Run focused unit and browser tests**

Run:

```bash
npm test -- __tests__/mapBannerStagingCss.test.ts __tests__/activationChromeCss.test.ts __tests__/mobileChromeFit.test.ts
PW_PORT=3000 PW_SKIP_WEBSERVER=1 npx playwright test e2e/map-near-me.spec.ts --project=chromium --workers=1
```

Expected: all pass.

- [ ] **Step 4: Measure after rate**

Use Chrome DevTools AXI with location permission `prompt`, cleared local and session storage, and 50 desktop loads split across widths 800, 1024, 1280, and 1600. Record attachment, paint, computed display, and bounding box. Expected: 50/50 painted and on-screen.

- [ ] **Step 5: Run final verification**

Run:

```bash
npm run lint
npm run typecheck
npm test
git diff --check
```

Confirm `next-env.d.ts` development rewrite is restored before commit.

- [ ] **Step 6: Commit fix**

```bash
git add components/map/mapBannerStaging.css __tests__/mapBannerStagingCss.test.ts
git commit -m "fix(map): keep Near me visible with city status"
```

### Task 3: Record Diagnosis and Rates

**Files:**
- Create: `docs/evidence/map-near-me-control/README.md`

**Interfaces:**
- Consumes: pre-fix and post-fix browser matrices.
- Produces: durable trigger, masking condition, symptom, counterfactual, falsifier, viewport results, and explicit pin-flicker non-finding for PR body.

- [ ] **Step 1: Write measured report**

Record:

- Pre-fix: 0/50 painted, 50/50 attached, all permission states `prompt`.
- Trigger: successful async city status response mounts `.cityStatusBanner`.
- Masking condition: status response absence or delay leaves control briefly painted.
- Symptom: attached control becomes invisible through ancestor `display: none`; it is not unmounted or off screen.
- Counterfactual: removing only status-to-location suppression restores control.
- Falsifier: control remains hidden without status-to-location suppression, or geometry leaves viewport once visible.
- Width split and post-fix sample counts.
- Pin flicker relationship was not measured.

- [ ] **Step 2: Commit evidence**

```bash
git add docs/evidence/map-near-me-control/README.md
git commit -m "docs(map): record Near me control diagnosis"
```

- [ ] **Step 3: Review final branch**

Run:

```bash
git status --short
git log --oneline --decorate -5
git diff HEAD~3..HEAD --check
```

Confirm only plan, regression, staging policy, and evidence changed.
