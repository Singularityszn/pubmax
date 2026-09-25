import { expect, test, type Page } from "@playwright/test";

import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "./helpers/communitySheetFixture";

// The route-end "Check last train" door asks the sheet for the getting-home
// fold on the Overview. It must land there with the fold open, and a second
// press after the reader closes the sheet must land there again.
//
// The door is pressed with the venue drawer CLOSED here. The same door with
// the drawer OPEN is e2e/drawer-route-chip-reachable.spec.ts: the route chip
// is an exempt surface of the drawer's focus trap (lib/useFocusTrap.ts).

const FIRST_STOP = "venue-yl1a48";
const FINAL_STOP = COMMUNITY_SHEET_FIXTURE_VENUE_ID;

async function pressDoor(page: Page) {
  const door = page
    .getByRole("button", { name: "Check last train at final stop" })
    .filter({ visible: true })
    .first();
  await expect(door).toBeVisible({ timeout: 60_000 });
  await door.click();
}

async function expectOverviewWithFoldOpen(page: Page) {
  const inspector = page.locator(".venueInspector").filter({ visible: true }).first();
  await expect(inspector).toBeVisible({ timeout: 30_000 });
  await expect(inspector.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const fold = inspector.locator("#venueSection-getting-home");
  await expect(fold).toHaveAttribute("open", "");
  await expect(fold.getByLabel("Last Pint")).toBeVisible();
}

test("desktop: Check last train opens the final stop on Overview with the fold open, every time", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto(`/map?mode=build&pubs=${FIRST_STOP}%2C${FINAL_STOP}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".venueInspector").filter({ visible: true })).toHaveCount(0);

  await pressDoor(page);
  await expectOverviewWithFoldOpen(page);

  await page.getByRole("button", { name: "Close pub detail" }).filter({ visible: true }).first().click();
  await expect(page.locator(".venueInspector").filter({ visible: true })).toHaveCount(0);

  await pressDoor(page);
  await expectOverviewWithFoldOpen(page);
});
