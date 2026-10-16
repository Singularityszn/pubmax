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
//
// ONE PLAN BUTTON (UX sprint, 15 Oct 2026; captain, 16 Oct 2026). The phone
// sheet used to carry "Plan stop" in the peek strip AND "Make it Stop 1" in
// the bar below it. The peek now carries one button that follows the night:
// with no crawl being built it is "Make it Stop 1", which hands the pub to
// Plan; with a crawl being built it is "Plan stop" / "In plan".

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const VENUE_NAME = COMMUNITY_SHEET_FIXTURE_VENUE_NAME;
// A crawl already being built, seeded through the map's own share URL.
const BUILT_STOP_ID = "venue-149rmv7";

async function preparePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test("phone 390: with a crawl being built, Plan stop adds to it, the pill names it, and the planner opens on it", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?mode=build&pubs=${BUILT_STOP_ID}&sel=${VENUE_ID}`);

  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const planStop = venuePortal.locator(".mobileVenuePeekSummary button");
  await expect(planStop).toHaveCount(1, { timeout: 30_000 });
  await expect(planStop).toHaveText("Plan stop", { timeout: 30_000 });
  // One plan door on the sheet: the bar's ghost stands down on a phone.
  await expect(venuePortal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` })).toHaveCount(0);
  await expect(async () => {
    await planStop.click();
    await expect(planStop).toHaveText("In plan", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get("mode")).toBe("build");
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(`${BUILT_STOP_ID},${VENUE_ID}`);

  // Close the sheet: the pill names the picked stops, never the suggested six.
  await venuePortal.locator(".surfaceNavHome").click();
  await expect(venuePortal).toHaveCount(0);
  const pill = page.locator(".mobilePlanActivation");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("2 stops picked");
  await expect(pill).toHaveAttribute("aria-label", "Edit your crawl, 2 stops picked");

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

test("phone 390: with no crawl being built, the one plan button is Make it Stop 1 and hands the pub to Plan", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?sel=${VENUE_ID}`);
  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const makeStop1 = venuePortal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(makeStop1).toHaveCount(1, { timeout: 30_000 });
  await expect(makeStop1).toBeVisible({ timeout: 30_000 });
  await expect(makeStop1).toHaveText("Make it Stop 1");
  await expect(venuePortal.locator(".mobileVenuePeekSummary button")).toHaveText("Make it Stop 1");
  await expect(venuePortal.getByRole("button", { name: /^(?:Plan stop|In plan)$/ })).toHaveCount(0);
  await expect(async () => {
    await makeStop1.click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});

// THE DOOR KEEPS ITS MEANING UNDER THE THUMB. The one button follows the crawl,
// so removing the LAST stop emptied the crawl while the sheet was still open
// and the same button node became "Make it Stop 1" with a navigation behind it:
// a second tap in the same spot left the map for /plan and abandoned the build
// session. While a pub's sheet is open the door stays the crawl's.
test("phone 390: emptying the crawl from the open sheet keeps the crawl's door, not a way off the map", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?mode=build&pubs=${VENUE_ID}&sel=${VENUE_ID}`);

  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const door = venuePortal.locator(".mobileVenuePeekSummary button");
  await expect(door).toHaveCount(1, { timeout: 30_000 });
  await expect(door).toHaveText("In plan", { timeout: 30_000 });

  // One tap removes the only stop. The crawl is now empty, and the door the
  // reader's thumb is still on is the crawl's, not a door to /plan.
  await expect(async () => {
    await door.click();
    await expect(door).toHaveText("Plan stop", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(venuePortal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` })).toHaveCount(0);

  // A second tap in the same spot puts the stop back. It never leaves the map.
  await door.click();
  await expect(door).toHaveText("In plan", { timeout: 10_000 });
  await expect(page).toHaveURL(/\/map/);
  await expect(venuePortal).toBeVisible();
});
