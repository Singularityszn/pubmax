import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

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

for (const [drink, noun] of [["wine", "wine"], ["cocktail", "cocktail"]] as const) {
  test(`Create routes ${drink} through the category price form`, async ({ page }) => {
    await installDeterministicMapBasemap(page);
    await page.goto(`/map?drink=${drink}`);
    await expect(async () => {
      await page.getByTestId("create-fab").click();
      await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }))
        .toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
    await expect(page).toHaveURL(new RegExp(`drink=${drink}.*contribute=price`));
    const picker = page.getByText("Pick a pub to log a price");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    const nearby = page.locator(".logIntentNearbyBtn").first();
    await expect(nearby).toBeVisible();
    await nearby.click();
    await expect(page.getByRole("textbox", { name: new RegExp(`Price of a ${noun} at`) }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("spill-price-step")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`drink=${drink}.*sel=[^&]+`));
  });
}

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
