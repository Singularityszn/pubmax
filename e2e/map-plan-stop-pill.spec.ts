import { expect, test, type Page } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";

// A PICKED PUB IS THE CRAWL BEING BUILT. verify-preview-4 J04 (5 Sep 2026):
// after one "Plan stop" on The Sir Christopher Hatton the phone pill read
// "6-stop plan · Edit route", because the tap mapped the SUGGESTED six-stop
// route rather than the pub the reader had picked, and the planner sheet then
// opened on the "Describe the outing" form with the picked pub a whole form
// below the fold. "Plan stop" now puts the map in build mode
// (components/PubMap.tsx, toggleBuiltStop), the pill names the built crawl
// (lib/planActivationPill.ts), and the built crawl leads the phone planner
// with its stops first (lib/pubMap.ts, phonePlannerOrder).

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const VENUE_NAME = COMMUNITY_SHEET_FIXTURE_VENUE_NAME;

async function preparePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test("phone 390: Plan stop builds a crawl, the pill names it, and the planner opens on it", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?sel=${VENUE_ID}`);

  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const planStop = venuePortal.locator(".mobileVenuePeekSummary button");
  await expect(planStop).toHaveText("Plan stop", { timeout: 30_000 });
  await expect(async () => {
    await planStop.click();
    await expect(planStop).toHaveText("In plan", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("mode")).toBe("build");
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(VENUE_ID);

  // Close the sheet: the pill names ONE picked stop, never the suggested six.
  await venuePortal.locator(".surfaceNavHome").click();
  await expect(venuePortal).toHaveCount(0);
  const pill = page.locator(".mobilePlanActivation");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("1 stop picked");
  await expect(pill).toHaveAttribute("aria-label", "Edit your crawl, 1 stop picked");

  // The planner sheet opens on the crawl being built: the picked pub is
  // named inside the sheet body's own visible box, before any form.
  await pill.click();
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(planner).toBeVisible({ timeout: 30_000 });
  const stop = planner.locator(".routeList li strong", { hasText: VENUE_NAME }).first();
  await expect(stop).toBeVisible({ timeout: 30_000 });
  const inFirstScreen = await stop.evaluate((el) => {
    const body = el.closest(".mobileSharedSheetBody");
    if (!body) return false;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= b.top && r.bottom <= b.bottom;
  });
  expect(inFirstScreen, "the picked pub is on the planner's first screen").toBe(true);
  const describeForm = planner.locator("#mobile-plan-intent-title");
  await expect(describeForm).toHaveCount(1);
  const order = await stop.evaluate((el) => {
    const form = document.querySelector("#mobile-plan-intent-title");
    return form ? Boolean(el.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
  });
  expect(order, "the built crawl comes before the describe form").toBe(true);
});

test("phone 390: Make it Stop 1 hands the pub to Plan", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?sel=${VENUE_ID}`);
  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const makeStop1 = venuePortal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(makeStop1).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await makeStop1.click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});
