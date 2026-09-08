import { expect, test, type Page } from "@playwright/test";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectTapTarget(
  locator: ReturnType<Page["locator"]>,
  label: string,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(Math.round(box.width), `${label} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height), `${label} height`).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.setViewportSize({ width: 390, height: 844 });
});

for (const closeSearch of [true, false]) {
  test(`mobile Search ${closeSearch ? "explicit close removes" : "direct Filters preserves"} its navigation parent`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

    const topbar = page.locator(".mobileMapTopbar");
    const search = topbar.getByRole("button", { name: "Search the map", exact: true });
    const input = page.getByRole("combobox", { name: "Search pubs", exact: true });
    await expectTapTarget(search, "map search action");
    await search.click();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    await expect(input).toBeVisible();

    if (closeSearch) {
      await search.click();
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(input).toBeHidden();
    }

    const filtersAction = topbar.getByRole("button", { name: "Filters", exact: true });
    await expectTapTarget(filtersAction, "drink filters button");
    await filtersAction.click();
    const filters = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(filters).toBeVisible();
    await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
    const back = filters.getByRole("button", { name: "Back to Search", exact: true });

    if (closeSearch) {
      await expect(back).toHaveCount(0);
      const close = filters.getByRole("button", { name: "Close Prices and places", exact: true });
      await expectTapTarget(close, "close filters");
      await close.click();
    } else {
      await expectTapTarget(back, "return to Search");
      await expect(filters.getByRole("button", { name: "Close and return to the map", exact: true })).toBeVisible();
      await back.click();
      await expect(search).toHaveAttribute("aria-expanded", "true");
      await expect(input).toBeVisible();
      await search.click();
    }

    await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(input).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test("mobile map controls: top bar, drink filters, and coordinated layers are tappable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  const topbar = page.locator(".mobileMapTopbar");
  await expect(topbar).toBeVisible();
  const city = topbar.getByRole("button", { name: "Map area: London. Change city", exact: true });
  const cityLabel = city.locator(".citySwitcherLabelFull");
  await expect(cityLabel).toBeVisible();
  await expect(cityLabel).toHaveText("London");
  await expect(city.locator(".citySwitcherLabelShort")).toBeHidden();
  await expectTapTarget(city, "city chooser");
  await expectTapTarget(topbar.getByRole("button", { name: "Search the map" }), "map search action");
  await topbar.getByRole("button", { name: "Search the map" }).click();
  const searchInput = page.getByRole("combobox", { name: "Search pubs", exact: true });
  await expect(searchInput).toBeVisible();
  await expectTapTarget(searchInput.locator(".."), "map search field");

  await topbar.getByRole("button", { name: "Search the map" }).click();
  const drinks = topbar.getByRole("button", { name: "Filters", exact: true });
  await expectTapTarget(drinks, "drink filters button");
  await drinks.click();
  const filters = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(filters).toBeVisible();
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);

  const drinkGroup = filters.getByRole("group", { name: "Filter by drink shape" });
  await expect(drinkGroup).toBeVisible();

  const wine = drinkGroup.getByRole("button", { name: "Wine" });
  await expectTapTarget(wine, "Wine drink-shape chip");
  await wine.click();
  await expect(wine).toHaveAttribute("aria-pressed", "true");
  await expect(drinkGroup.getByRole("button", { name: "Wine (selected)" })).toBeVisible();

  const gin = drinkGroup.getByRole("button", { name: "Gin", exact: true });
  await expectTapTarget(gin, "Gin drink-shape chip");
  await gin.click();
  await expect(drinkGroup.getByRole("button", { name: "Gin (selected)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(drinkGroup.getByRole("button", { name: "Wine", exact: true })).toHaveAttribute("aria-pressed", "false");
  // Non-beer categories have no brand evidence. They offer no refinements.
  await expect(filters.getByRole("group", { name: "Refine Gin", exact: true })).toHaveCount(0);
  await filters.getByRole("button", { name: "Close Prices and places", exact: true }).click();

  const layersFab = topbar.getByRole("button", { name: "More map controls" });
  await expectTapTarget(layersFab, "layers button");
  await layersFab.click();

  const layers = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  await expect(layers).toBeVisible();
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);

  const poiGroup = layers.getByRole("group", { name: "Points of interest" });
  await expect(poiGroup).toBeVisible();
  const firstPoiToggle = poiGroup.locator("button.mapLayersChip").first();
  await expectTapTarget(firstPoiToggle, "POI layer chip");
  const before = await firstPoiToggle.getAttribute("aria-pressed");
  expect(before === "true" || before === "false").toBe(true);
  await firstPoiToggle.click();
  await expect(firstPoiToggle).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );

  const stories = layers.getByRole("group", { name: "Place stories" });
  await expect(stories).toBeVisible();
  const riverHistory = stories.getByRole("button", { name: "River history" });
  await expectTapTarget(riverHistory, "place story layer chip");
  await riverHistory.click();
  await expect(riverHistory).toHaveAttribute("aria-pressed", "true");

  await layers.getByRole("button", { name: "Close Map controls", exact: true }).click();
  await expect(layers).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("critical city status badges TfL without adding a third chrome row", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-14T20:00:00.000Z",
        signals: [
          {
            headline: "Weaver Line suspension",
            kind: "transport",
            severity: "notable",
          },
        ],
        tubeLines: [],
        weather: null,
      }),
    }),
  );

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await expect(page.locator(".mobileMapChrome > :visible")).toHaveCount(2);
  await expect(page.locator(".cityStatusBanner")).toHaveCount(0);
  const tfl = page.getByRole("button", { name: /TfL/ });
  await expectTapTarget(tfl, "TfL status chip");
  await expect(tfl).toContainText("1");
  await tfl.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Weaver Line suspension")).toBeVisible();
});
