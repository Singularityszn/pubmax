import { expect, test } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const SEED_VENUE_NAME = "Prospect of Whitby";
const VIEWPORT = { width: 390, height: 844 };

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

// The ONE price door on the Overview (lib/pintTrust.ts, `overviewPriceDoor`):
// the composer is folded behind it, and the sticky bar carries no price action.
const DOOR_NAME = `Log tonight's price at ${SEED_VENUE_NAME}`;

test("a drinker opens the folded price form from the one price door", async ({
  page,
}) => {
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet.locator("[data-price-door]")).toHaveCount(1);
  await sheet.getByRole("button", { name: DOOR_NAME }).click();

  const priceField = sheet.getByRole("textbox", {
    name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
  });
  await expect(priceField).toBeVisible();
  await expect(priceField).toBeFocused();
  // The door folds away once the form it opens is on screen.
  await expect(sheet.locator("[data-price-door]")).toHaveCount(0);
});

test("desktop venue sheet exposes the same clear price action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator(".mapDrawer.right");
  await sheet.getByRole("button", { name: DOOR_NAME }).click();

  await expect(
    sheet.getByRole("textbox", {
      name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
    }),
  ).toBeVisible();
});
