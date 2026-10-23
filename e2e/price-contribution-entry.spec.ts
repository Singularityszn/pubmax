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

test("Create reopens an identical Wine request after Filters and dismissal", async ({ page }) => {
  await installDeterministicMapBasemap(page);
  await page.goto("/map/manchester?drink=wine");
  const filters = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(async () => {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(filters).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(filters).toHaveCount(0);

  const picker = page.getByText("Pick a pub to log a price", { exact: true });
  for (let request = 0; request < 2; request += 1) {
    await page.getByTestId("create-fab").click();
    await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
    await expect(picker).toBeVisible({ timeout: 45_000 });
    expect(new URL(page.url()).searchParams.get("contribute")).toBe("price");
    expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
    expect(new URL(page.url()).pathname).toBe("/map/manchester");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get("contribute")).toBeNull();
  }
});

for (const { width, city, drink } of [
  { width: 390, city: "manchester", drink: "wine" },
  { width: 1440, city: "bristol", drink: "cocktail" },
] as const) {
  test(`${width}px ${width === 390 ? "Create reopens a dismissed" : "contribution URL opens a"} ${drink} request and preserves its category on reset`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installDeterministicMapBasemap(page);
    await page.goto(`/map/${city}?drink=${drink}&q=zzzznonexistentpub${width === 1440 ? "&contribute=price" : ""}`);
    const picker = page.getByText("Pick a pub to log a price", { exact: true });
    if (width === 390) {
      for (let request = 0; request < 2; request += 1) {
        await expect(async () => {
          await page.getByTestId("create-fab").click();
          await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }))
            .toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
        await expect(picker).toBeVisible({ timeout: 45_000 });
        if (request === 0) {
          await page.keyboard.press("Escape");
          await expect(picker).toBeHidden();
          await expect.poll(() => new URL(page.url()).searchParams.get("contribute")).toBeNull();
        }
      }
    } else {
      await expect(picker).toBeVisible({ timeout: 45_000 });
    }
    await page.getByRole("button", { name: "Show all pubs", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
    expect(new URL(page.url()).searchParams.get("drink")).toBe(drink);
    const nearby = page.locator(".logIntentNearbyBtn").first();
    await expect(nearby).toBeVisible();
    // A picker re-sort between press and release drops the tap, so only a
    // dropped tap is retried (e2e/design-review-followups.spec.ts).
    await expect(async () => {
      if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
      await expect(page.getByRole("textbox", { name: new RegExp(`Price of a ${drink} at`) })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe(`/map/${city}`);
    await expect(page.getByTestId("spill-price-step")).toHaveCount(0);
  });

  test(`${width}px contribution search stays open as results change`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installDeterministicMapBasemap(page);
    await page.goto(`/map/${city}?drink=${drink}&contribute=price`);
    const picker = page.locator(".logIntentFallback");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await picker.getByRole("button", { name: "Search pubs", exact: true }).click();
    const search = page.locator(width === 390 ? "#mobileMapSearchInput" : "#mapSearchInput");
    await expect(search).toBeVisible();
    await search.fill("zzzznonexistentpub");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("zzzznonexistentpub");
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await expect(picker).toBeHidden();
    expect(new URL(page.url()).searchParams.get("contribute")).toBe("price");
    expect(new URL(page.url()).searchParams.get("drink")).toBe(drink);
  });
}

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
    // A picker re-sort between press and release drops the tap, so only a
    // dropped tap is retried (e2e/design-review-followups.spec.ts).
    await expect(async () => {
      if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
      await expect(page.getByRole("textbox", { name: new RegExp(`Price of a ${noun} at`) })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
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
