import { expect, test, type Locator, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

type ListedQuote = {
  venueId: string;
  source: "listed";
  category: "beer";
  priceGbp: number;
  drinkLabel: string;
  servingSize: string | null;
  sourceUrl: string;
  observedAt: string;
};

type CategoryIndex = {
  prices: unknown[];
  listedPrices: ListedQuote[];
  servingGroups: string[];
  truncated: false;
};

const albion = "venue-1qge8u";
const syntheticMenu = "https://synthetic.example.test/menus/mobile-subtype-fixture.pdf";
const observedAt = "2026-10-03T12:00:00.000Z";

test.use({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

function ciderQuote(servingSize: string | null): ListedQuote {
  return {
    venueId: albion,
    source: "listed",
    category: "beer",
    priceGbp: 8,
    drinkLabel: "E2E Orchard Cider",
    servingSize,
    sourceUrl: syntheticMenu,
    observedAt,
  };
}

async function installCiderIndexFixture(page: Page, quote: ListedQuote): Promise<void> {
  await page.route("**/api/price-submit**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname !== "/api/price-submit" || url.searchParams.get("drinkCategory") !== "beer") {
      await route.continue();
      return;
    }

    const serving = url.searchParams.get("serving");
    const listedPrices = serving && serving !== quote.servingSize ? [] : [quote];
    const body: CategoryIndex = {
      prices: [],
      listedPrices,
      servingGroups: quote.servingSize ? [quote.servingSize] : [],
      truncated: false,
    };
    await route.fulfill({ status: 200, contentType: "application/json", json: body });
  });
}

async function openMobileMap(page: Page, path = "/map"): Promise<void> {
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
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function openFilters(page: Page): Promise<Locator> {
  const topbar = page.locator(".mobileMapTopbar");
  const button = topbar.getByRole("button", { name: /^Filters/ });
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
  await expect(async () => {
    await button.click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return sheet;
}

async function openAlbionPeek(page: Page): Promise<{ peek: Locator; venueSheet: Locator }> {
  const searchButton = page.getByRole("button", { name: "Search the map", exact: true });
  const search = page.getByRole("combobox", { name: "Search places" });
  await expect(async () => {
    await searchButton.click();
    await expect(search).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await search.fill("Albion");
  const option = page.getByRole("listbox", { name: "Search suggestions" })
    .getByRole("group", { name: "Venues", exact: true })
    .locator(`[role="option"][data-venue-id="${albion}"]`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  const venueName = await option.locator(".mapSearchSuggestRowName").innerText();
  await option.click();

  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]:visible');
  await expect(venueSheet).toBeVisible({ timeout: 30_000 });
  await expect(venueSheet.getByRole("heading", { name: venueName, exact: true })).toBeVisible();
  const peek = venueSheet.locator(".mobileVenuePeekSummary");
  await expect(peek).toHaveCount(1);
  return { peek, venueSheet };
}

test("unknown-serving Cider £8 stays neutral, and Cider chip survives Drink close", async ({ page }) => {
  test.setTimeout(90_000);
  await installCiderIndexFixture(page, ciderQuote(null));
  await openMobileMap(page, "/map?drink=beer&sub=beer-cider");

  const { peek, venueSheet } = await openAlbionPeek(page);
  await expect(peek.locator(".priceBadge")).toHaveText("£8.00");
  await expect(peek.locator(".priceBadge")).not.toHaveClass(/priceBand-/);
  await expect(peek.locator("small").filter({ hasText: /^Cider$/ })).toHaveText("Cider");

  await venueSheet.getByRole("button", { name: "Close and return to the map" }).click();
  const filters = await openFilters(page);
  await filters.getByRole("button", { name: "Close Prices and places" }).click();
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')).toHaveCount(0);
  const chip = page.locator(".mobileMapChrome .mobileMapDrinkChip");
  await expect(chip).toHaveAccessibleName("Drink shown on the map: Cider. Choose another drink");
});

test("500ml Cider £8 remains unbanded on mobile map peek", async ({ page }) => {
  test.setTimeout(90_000);
  await installCiderIndexFixture(page, ciderQuote("500ml"));
  await openMobileMap(page, "/map?drink=beer&sub=beer-cider&serving=500ml");

  const { peek } = await openAlbionPeek(page);
  await expect(peek.locator(".priceBadge")).toHaveText("£8.00");
  await expect(peek.locator(".priceBadge")).not.toHaveClass(/priceBand-/);
  await expect(peek.locator("small").filter({ hasText: /^Cider$/ })).toHaveText("Cider");
});

test("explicit pint Cider £8 keeps its price band on mobile map peek", async ({ page }) => {
  test.setTimeout(90_000);
  await installCiderIndexFixture(page, ciderQuote("pint"));
  await openMobileMap(page, "/map?drink=beer&sub=beer-cider&serving=pint");

  const { peek } = await openAlbionPeek(page);
  await expect(peek.locator(".priceBadge")).toHaveText("£8.00");
  await expect(peek.locator(".priceBadge")).toHaveClass(/priceBand-/);
  await expect(peek.locator("small").filter({ hasText: /^Cider$/ })).toHaveText("Cider");
});

test("Gin 25ml changed to Wine stays Wine with no serving when Prices closes", async ({ page }) => {
  test.setTimeout(90_000);
  await openMobileMap(page, "/map?drink=gin&sub=gin-london-dry&serving=25ml");
  const filters = await openFilters(page);
  const wine = filters.getByRole("group", { name: "Filter by drink shape" })
    .getByRole("button", { name: /^Wine/ });
  await wine.click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("drink") === "wine" && !url.searchParams.has("serving"));
  await filters.getByRole("button", { name: "Close Prices and places" }).click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("drink") === "wine" && !url.searchParams.has("serving"));
});

test("opening and closing Prices on unchanged Gin 25ml preserves serving", async ({ page }) => {
  test.setTimeout(90_000);
  await openMobileMap(page, "/map?drink=gin&sub=gin-london-dry&serving=25ml");
  const filters = await openFilters(page);
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("drink") === "gin"
      && url.searchParams.get("sub") === "gin-london-dry"
      && url.searchParams.get("serving") === "25ml");
  await filters.getByRole("button", { name: "Close Prices and places" }).click();
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("drink") === "gin"
      && url.searchParams.get("sub") === "gin-london-dry"
      && url.searchParams.get("serving") === "25ml");
});
