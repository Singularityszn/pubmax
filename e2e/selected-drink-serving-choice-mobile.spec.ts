import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type ListedQuote = {
  venueId: string;
  source: "listed";
  category: "wine";
  priceGbp: number;
  drinkLabel: string;
  servingSize: string;
  sourceUrl: string;
  observedAt: string;
};

type CategoryIndex = {
  prices: unknown[];
  listedPrices: ListedQuote[];
  servingGroups: string[];
  truncated: false;
};

const punchAndJudy = "venue-11bllvc";
const syntheticMenu = "https://synthetic.example.test/menus/mobile-serving-choice.pdf";
const observedAt = "2026-10-03T12:00:00.000Z";

test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

test("Gin 25ml clears to All servings and stays cleared after Drink closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00.000Z"));
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  expect((await page.goto("/map?drink=gin&sub=gin-london-dry&serving=25ml"))?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await page.locator(".mobileMapChrome .mobileMapDrinkChip").click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]:visible');
  await expect(sheet).toBeVisible();
  const servingGroup = sheet.getByRole("group", { name: "Serving size for price comparison" });
  const allServings = servingGroup.getByRole("button", { name: "All servings · unranked", exact: true });
  await expect(allServings).toBeVisible();
  await allServings.click();
  const cleared = (url: URL) =>
    url.searchParams.get("drink") === "gin"
      && url.searchParams.get("sub") === "gin-london-dry"
      && !url.searchParams.has("serving");
  await expect(page).toHaveURL(cleared);

  await sheet.getByRole("button", { name: "Close Drink" }).click();
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="drink"]')).toHaveCount(0);
  await expect(page).toHaveURL(cleared);
});

test("White wine 175ml changes to 250ml and stays selected after Drink closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00.000Z"));
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const white175: ListedQuote = {
    venueId: punchAndJudy,
    source: "listed",
    category: "wine",
    priceGbp: 4,
    drinkLabel: "E2E House White",
    servingSize: "175ml",
    sourceUrl: syntheticMenu,
    observedAt,
  };
  const white250: ListedQuote = {
    ...white175,
    priceGbp: 5.75,
    servingSize: "250ml",
  };
  await page.route("**/api/price-submit**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname !== "/api/price-submit" || url.searchParams.get("drinkCategory") !== "wine") {
      await route.continue();
      return;
    }

    const serving = url.searchParams.get("serving");
    const listedPrices = serving === "175ml"
      ? [white175]
      : serving === "250ml"
        ? [white250]
        : [white175, white250];
    const body: CategoryIndex = {
      prices: [],
      listedPrices,
      servingGroups: ["175ml", "250ml"],
      truncated: false,
    };
    await route.fulfill({ status: 200, contentType: "application/json", json: body });
  });

  expect((await page.goto("/map?drink=wine&sub=wine-white&serving=175ml"))?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await page.locator(".mobileMapChrome .mobileMapDrinkChip").click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]:visible');
  await expect(sheet).toBeVisible();
  const servingGroup = sheet.getByRole("group", { name: "Serving size for price comparison" });
  const serving250 = servingGroup.getByRole("button", { name: "250ml", exact: true });
  await expect(serving250).toBeVisible({ timeout: 30_000 });
  await serving250.click();
  const selected250 = (url: URL) =>
    url.searchParams.get("drink") === "wine"
      && url.searchParams.get("sub") === "wine-white"
      && url.searchParams.get("serving") === "250ml";
  await expect(page).toHaveURL(selected250);

  await sheet.getByRole("button", { name: "Close Drink" }).click();
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="drink"]')).toHaveCount(0);
  await expect(page).toHaveURL(selected250);
});

test("Pints stays selected after leaving Gin through the Drink sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00.000Z"));
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  expect((await page.goto("/map?drink=gin&sub=gin-london-dry&serving=25ml"))?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  const chip = page.locator(".mobileMapChrome .mobileMapDrinkChip");
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]:visible');
  await chip.click();
  await expect(sheet).toBeVisible();

  const pints = sheet
    .getByRole("group", { name: "Drink prices shown on the map" })
    .getByRole("button", { name: "Pints", exact: true });
  await expect(pints).toBeVisible();
  await pints.click();
  const defaultMap = (url: URL) =>
    url.pathname === "/map"
      && !url.searchParams.has("drink")
      && !url.searchParams.has("sub")
      && !url.searchParams.has("serving");
  await expect(pints).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(defaultMap);

  await sheet.getByRole("button", { name: "Close Drink", exact: true }).click();
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="drink"]')).toHaveCount(0);
  await expect(page).toHaveURL(defaultMap);
  await expect(chip).toHaveAccessibleName("Drink shown on the map: Pints. Choose another drink");
});
