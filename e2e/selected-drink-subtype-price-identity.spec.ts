import { expect, test, type Locator, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapToolbarReady, mapToolbar } from "./helpers/mapToolbar";

type ListedQuote = {
  venueId: string;
  source: "listed";
  category: "wine" | "beer";
  priceGbp: number;
  drinkLabel: string;
  servingSize: string;
  sourceUrl: string;
  observedAt: string;
};

const punchAndJudy = "venue-11bllvc";
const albion = "venue-1qge8u";
const syntheticMenu = "https://synthetic.example.test/menus/map-subtype-fixture.pdf";
const observedAt = "2026-10-02T12:00:00.000Z";

const redWine: ListedQuote = {
  venueId: punchAndJudy,
  source: "listed",
  category: "wine",
  priceGbp: 8,
  drinkLabel: "E2E House Red",
  servingSize: "175ml",
  sourceUrl: syntheticMenu,
  observedAt,
};
const whiteWine: ListedQuote = {
  ...redWine,
  priceGbp: 4,
  drinkLabel: "E2E House White",
};
const ciderPint: ListedQuote = {
  venueId: albion,
  source: "listed",
  category: "beer",
  priceGbp: 8,
  drinkLabel: "E2E Orchard Cider",
  servingSize: "pint",
  sourceUrl: syntheticMenu,
  observedAt,
};

type CategoryIndex = {
  prices: unknown[];
  listedPrices: ListedQuote[];
  servingGroups: string[];
  truncated: false;
};

async function installPriceIndexFixture(
  page: Page,
  { includeRedWine = true }: { includeRedWine?: boolean } = {},
): Promise<void> {
  await page.route("**/api/price-submit**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.pathname !== "/api/price-submit" || !url.searchParams.has("drinkCategory")) {
      await route.continue();
      return;
    }

    const category = url.searchParams.get("drinkCategory");
    const subtype = url.searchParams.get("drinkSubtype");
    const serving = url.searchParams.get("serving");
    let listedPrices: ListedQuote[] = [];
    let servingGroups: string[] = [];
    if (category === "wine") {
      // Generic Wine keeps both source quotes, so its existing category-wide
      // minimum remains White £4. This test boundary returns only selected
      // quotes for subtype reads, before the map chooses a per-venue minimum.
      const wineRows = includeRedWine ? [redWine, whiteWine] : [whiteWine];
      listedPrices = subtype === "wine-red"
        ? wineRows.filter((row) => row.drinkLabel === redWine.drinkLabel)
        : subtype === "wine-white"
          ? wineRows.filter((row) => row.drinkLabel === whiteWine.drinkLabel)
          : subtype === null
            ? wineRows
            : [];
      servingGroups = ["175ml"];
    } else if (category === "beer" && subtype === "beer-cider" && serving === "pint") {
      listedPrices = [ciderPint];
      servingGroups = ["pint"];
    }

    const body: CategoryIndex = {
      prices: [],
      listedPrices,
      servingGroups,
      truncated: false,
    };
    await route.fulfill({ status: 200, contentType: "application/json", json: body });
  });
}

async function openMapForSubtype(
  page: Page,
  url: string,
  options: { includeRedWine?: boolean } = {},
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-03T12:00:00.000Z"));
  await installDeterministicMapBasemap(page);
  await installPriceIndexFixture(page, options);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  expect((await page.goto(url))?.status()).toBe(200);
  await expectMapToolbarReady(page);
}

async function expectSearchQuote(page: Page, query: string, expectedText: string, venueId: string): Promise<Locator> {
  const search = mapToolbar(page).getByRole("combobox", { name: "Search places" });
  await search.fill(query);
  const option = page.getByRole("listbox", { name: "Search suggestions" })
    .getByRole("group", { name: "Venues", exact: true })
    .locator(`[role="option"][data-venue-id="${venueId}"]`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await expect(option.locator(".mapSearchSuggestPrice")).toHaveText(expectedText);
  return option;
}

test.use({
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

for (const selected of [
  { subtype: "wine-red", label: "Red wine", price: "£8.00", otherPrice: "£4.00", drink: "E2E House Red" },
  { subtype: "wine-white", label: "White wine", price: "£4.00", otherPrice: "£8.00", drink: "E2E House White" },
] as const) {
  test(`${selected.label} Map search uses same-serving ${selected.drink} quote`, async ({ page }) => {
    test.setTimeout(90_000);
    const indexResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/price-submit"
        && url.searchParams.get("drinkCategory") === "wine"
        && url.searchParams.get("serving") === "175ml";
    });
    const [, response] = await Promise.all([
      openMapForSubtype(page, `/map?drink=wine&sub=${selected.subtype}&serving=175ml`),
      indexResponse,
    ]);
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get("drinkSubtype")).toBe(selected.subtype);
    const index = await response.json() as CategoryIndex;
    expect(index.prices).toEqual([]);
    expect(index.listedPrices).toEqual([expect.objectContaining({
      venueId: punchAndJudy,
      category: "wine",
      drinkLabel: selected.drink,
      priceGbp: selected.subtype === "wine-red" ? 8 : 4,
      servingSize: "175ml",
      sourceUrl: syntheticMenu,
      observedAt,
    })]);

    const option = await expectSearchQuote(page, "Punch", `${selected.label} · ${selected.price} · 175ml`, punchAndJudy);
    await expect(option).not.toContainText(selected.otherPrice);
  });
}

test("a Red wine selection with only a White quote stays honestly unpriced", async ({ page }) => {
  test.setTimeout(90_000);
  const indexResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/price-submit"
      && url.searchParams.get("drinkCategory") === "wine"
      && url.searchParams.get("serving") === "175ml";
  });
  const [, response] = await Promise.all([
    openMapForSubtype(page, "/map?drink=wine&sub=wine-red&serving=175ml", { includeRedWine: false }),
    indexResponse,
  ]);
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get("drinkSubtype")).toBe("wine-red");
  const index = await response.json() as CategoryIndex;
  expect(index.prices).toEqual([]);
  // The synthetic menu has a White offer, but selected Red has no matching
  // quote at the requested serving. This mocked API boundary returns the
  // expected selection shape; this spec does not test server-side projection.
  expect(index.listedPrices).toEqual([]);
  const option = await expectSearchQuote(page, "Punch", "No red wine price logged", punchAndJudy);
  await expect(option).not.toContainText("£8.00");
  await expect(option).not.toContainText("£4.00");
});

test("explicit pint Cider search uses named cider quote, not generic beer amount", async ({ page }) => {
  test.setTimeout(90_000);
  const indexResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/price-submit"
      && url.searchParams.get("drinkCategory") === "beer"
      && url.searchParams.get("serving") === "pint";
  });
  const [, response] = await Promise.all([
    openMapForSubtype(page, "/map?drink=beer&sub=beer-cider&serving=pint"),
    indexResponse,
  ]);
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get("drinkSubtype")).toBe("beer-cider");
  const index = await response.json() as CategoryIndex;
  expect(index.prices).toEqual([]);
  expect(index.listedPrices).toEqual([expect.objectContaining({
    venueId: albion,
    category: "beer",
    drinkLabel: "E2E Orchard Cider",
    priceGbp: 8,
    servingSize: "pint",
    sourceUrl: syntheticMenu,
    observedAt,
  })]);

  const option = await expectSearchQuote(page, "Albion", "Cider · £8.00", albion);
  await expect(option).not.toContainText("£5.40");
});
