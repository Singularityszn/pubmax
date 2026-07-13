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

test("mobile map controls: drink filters, city switcher, and layers are tappable", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  const toolbar = page.locator(".mapToolbar").first();
  await expect(toolbar).toBeVisible();
  await expectTapTarget(
    page.getByRole("searchbox", { name: /search pubs by name/i }),
    "map search input",
  );

  const drinks = page.getByRole("button", { name: "Show drink filters" });
  await expectTapTarget(drinks, "drink filters button");
  await drinks.click();
  await expect(page.getByRole("button", { name: "Hide drink filters" })).toBeVisible();

  const drinkGroup = page.getByRole("group", { name: "Filter by drink shape" });
  await expect(drinkGroup).toBeVisible();

  const wine = drinkGroup.getByRole("button", { name: "Wine" });
  await expectTapTarget(wine, "Wine drink-shape chip");
  await wine.click();
  await expect(wine).toHaveAttribute("aria-pressed", "true");
  await expect(drinkGroup.getByRole("button", { name: "Wine (selected)" })).toBeVisible();

  const category = page.getByLabel("Drink category");
  await expect(category).toBeVisible();
  await category.selectOption("gin");
  await expect(page.getByLabel("Gin brand")).toBeVisible();

  const city = page.getByRole("button", { name: "City map: London. Change city" });
  await expectTapTarget(city, "city switcher");
  await city.click();

  const cityList = page.getByRole("listbox", { name: "Choose city map" });
  await expect(cityList).toBeVisible();
  await expect(cityList.getByRole("option", { name: "London" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await cityList.getByRole("button", { name: "Manchester" }).click();
  await expect(page).toHaveURL(/\/map\/manchester(?:$|\?)/);
  await expect(
    page.getByRole("button", { name: "City map: Manchester. Change city" }),
  ).toBeVisible({ timeout: 20_000 });

  await page.goto("/map");
  await expect(page.locator(".mapToolbar").first()).toBeVisible({ timeout: 20_000 });

  const layersFab = page.getByRole("button", { name: /Map layers/i });
  await expectTapTarget(layersFab, "layers button");
  await layersFab.click();

  const layers = page.getByRole("dialog", { name: "Map layers" });
  await expect(layers).toBeVisible();

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

  await page.getByRole("button", { name: "Close layers" }).click();
  await expect(layers).toHaveCount(0);

  expect(errors).toEqual([]);
});
