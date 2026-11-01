import { expect, test, type Page } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { MOBILE_MAP_SHELL_READY_MS } from "./helpers/mobileMapShell";

// ONE PLAN DOOR, AND IT FOLLOWS THE CRAWL (owner decision option C, 16 Oct
// 2026; lib/venuePlanDoor.ts). The phone pub sheet carries one coral plan door
// in its peek. With no crawl in progress it is `Make it Stop 1` and hands the
// pub to Plan. With a crawl in progress it is `Plan stop` / `In plan` and adds
// the pub to or takes it off the crawl on the map. Removing the last stop ends
// the crawl, so the door reads `Make it Stop 1` again with no latch between.
//
// A PICKED PUB IS STILL THE CRAWL BEING BUILT. verify-preview-4 J04 (5 Sep
// 2026): after one "Plan stop" the phone pill read "6-stop plan · Edit route",
// because the tap mapped the SUGGESTED six-stop route rather than the crawl
// the reader had picked. The toggle keeps the map in build mode
// (components/PubMap.tsx, toggleBuiltStop), the pill names the built crawl
// (lib/planActivationPill.ts), and the built crawl leads the phone planner
// with its stops first (lib/pubMap.ts, phonePlannerOrder).

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const VENUE_NAME = COMMUNITY_SHEET_FIXTURE_VENUE_NAME;
// The crawl already in progress when the reader opens VENUE: one picked stop.
const CRAWL_STOP_ID = "venue-xjf3n0";
const CRAWL_STOP_NAME = "Arnos Arms";
const PLAN_DOOR_NAME = /Stop 1$|^Plan stop$|^In plan$|crawl$|^Crawl$|^Remove$/;

async function preparePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test("phone 390: in a crawl in progress, Plan stop adds the pub and In plan takes it off; the pill names the crawl", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?mode=build&pubs=${CRAWL_STOP_ID}&sel=${VENUE_ID}`);

  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const planStop = venuePortal.locator(".mobileVenuePeekSummary button");
  await expect(planStop).toHaveText("Plan stop", { timeout: 30_000 });
  await expect(planStop).toHaveAttribute("aria-pressed", "false");
  // One plan door on the whole phone sheet, in build mode too.
  await expect(venuePortal.getByRole("button", { name: PLAN_DOOR_NAME })).toHaveCount(1);
  await expect(
    venuePortal.getByRole("toolbar", { name: "Venue actions" }).getByRole("button"),
  ).toHaveText(["Ask for a table", "Share"]);

  await expect(async () => {
    await planStop.click();
    await expect(planStop).toHaveText("In plan", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(planStop).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("mode")).toBe("build");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("pubs"))
    .toBe(`${CRAWL_STOP_ID},${VENUE_ID}`);
  await expect(venuePortal.getByRole("button", { name: PLAN_DOOR_NAME })).toHaveCount(1);

  // In plan takes it off again; the crawl keeps its first stop, so the door
  // stays the crawl's toggle.
  await planStop.click();
  await expect(planStop).toHaveText("Plan stop");
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(CRAWL_STOP_ID);

  // Close the sheet: the pill names ONE picked stop, never the suggested six.
  await venuePortal.locator(".surfaceNavHome").click();
  await expect(venuePortal).toHaveCount(0);
  const pill = page.locator(".mobilePlanActivation");
  await expect(pill).toBeVisible({ timeout: MOBILE_MAP_SHELL_READY_MS });
  await expect(pill).toContainText("1 stop picked");
  await expect(pill).toHaveAttribute("aria-label", "Edit your crawl, 1 stop picked");

  // The planner sheet opens on the crawl being built: the picked pub is
  // named inside the sheet body's own visible box, before any form.
  await pill.click();
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(planner).toBeVisible({ timeout: 30_000 });
  const stop = planner.locator(".routeList li strong", { hasText: CRAWL_STOP_NAME }).first();
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

test("phone 390: with no crawl in progress, the one door is Make it Stop 1 and hands the pub to Plan", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?sel=${VENUE_ID}`);
  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const makeStop1 = venuePortal
    .locator(".mobileVenuePeekSummary")
    .getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(makeStop1).toBeVisible({ timeout: 30_000 });
  await expect(makeStop1).toHaveText("Make it Stop 1");
  await expect(venuePortal.getByRole("button", { name: PLAN_DOOR_NAME })).toHaveCount(1);
  await expect(async () => {
    await makeStop1.click();
    await expect(page).toHaveURL(/\/plan(?:\?|$)/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});

test("phone 390: removing the last stop ends the crawl, and the door reads Make it Stop 1 again", async ({ page }) => {
  test.slow();
  await preparePage(page);
  await page.goto(`/map?mode=build&pubs=${VENUE_ID}&sel=${VENUE_ID}`);
  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venuePortal).toBeVisible({ timeout: 30_000 });
  const door = venuePortal.locator(".mobileVenuePeekSummary button");
  await expect(door).toHaveText("In plan", { timeout: 30_000 });
  await expect(async () => {
    await door.click();
    await expect(door).toHaveText("Make it Stop 1", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(door).toHaveAttribute("aria-label", `Make ${VENUE_NAME} Stop 1`);
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBeNull();
  await expect(venuePortal.getByRole("button", { name: PLAN_DOOR_NAME })).toHaveCount(1);
});

// Evidence: the crawl's door at both pinned widths, in its two states.
for (const width of [320, 390] as const) {
  test(`phone ${width}: the crawl door reads Plan stop then In plan, and Share stands alone`, async ({ page }) => {
    test.slow();
    await preparePage(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/map?mode=build&pubs=${CRAWL_STOP_ID}&sel=${VENUE_ID}`);
    const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const door = venuePortal.locator(".mobileVenuePeekSummary button");
    await expect(door).toHaveText("Plan stop", { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `docs/proof/one-plan-door/plan-stop-${width}.png` });
    await expect(async () => {
      await door.click();
      await expect(door).toHaveText("In plan", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `docs/proof/one-plan-door/in-plan-${width}.png` });
  });
}
