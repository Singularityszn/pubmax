import { expect, test, type Page } from "@playwright/test";

import { expectLayoutSettled } from "./helpers/layoutSettled";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectTapTarget(
  locator: ReturnType<Page["locator"]>,
  label: string,
): Promise<void> {
  // A sheet and its panels scale in as they open, so the box is read once the
  // product says it is at rest: a chip caught mid-entry measures under its
  // 44px rest size.
  await expectLayoutSettled(locator);
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
  // The place name is the city switcher's own full label, the text a phone
  // reader sees in the one top bar (components/map/CitySwitcher.tsx).
  const area = topbar.getByRole("button", { name: "Map area: London. Change city" });
  await expectTapTarget(area, "map area switcher");
  await expect(area.locator(".citySwitcherLabelFull")).toHaveText("London");
  await expectTapTarget(topbar.getByRole("button", { name: "Search the map" }), "map search action");
  await topbar.getByRole("button", { name: "Search the map" }).click();
  // The field suggests pubs as it is typed in, so it is a combobox.
  const searchInput = page.getByRole("combobox", { name: "Search pubs" });
  await expect(searchInput).toBeVisible();
  await expectTapTarget(searchInput.locator(".."), "map search field");

  await topbar.getByRole("button", { name: "Search the map" }).click();
  // The drink filters live in the Filters sheet, opened from the top bar
  // (#1631: one bar, and the category row moved into Filters).
  const filtersButton = topbar.getByRole("button", { name: /^Filters/ });
  await expectTapTarget(filtersButton, "filters button");
  await filtersButton.click();
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

  // A second drink replaces the first. The old category select and its brand
  // picker are gone: the drink shape chips are the one category control, and
  // the brand slot moved into the drink lane's own panel (#1631).
  const gin = drinkGroup.getByRole("button", { name: "Gin" });
  await expectTapTarget(gin, "Gin drink-shape chip");
  await gin.click();
  await expect(gin).toHaveAttribute("aria-pressed", "true");
  await expect(wine).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/[?&]drink=gin(?:&|$)/);
  await filters.getByRole("button", { name: "Close Prices and places" }).click();
  await expect(filters).toHaveCount(0);
  await expect(
    page
      .locator(".mobileMapChrome")
      .getByRole("button", { name: "Drink shown on the map: Gin. Choose another drink" }),
  ).toBeVisible();

  const layersFab = topbar.getByRole("button", { name: "More map controls" });
  await expectTapTarget(layersFab, "layers button");
  await layersFab.click();

  const layers = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  await expect(layers).toBeVisible();
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
  // The Map controls sheet opens on its Key tab; the layer toggles are on
  // the Layers tab.
  await layers.getByRole("tab", { name: "Layers" }).click();

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

  await layers.getByRole("button", { name: "Close Map controls" }).click();
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
