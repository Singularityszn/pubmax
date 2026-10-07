import { expect, test } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.setViewportSize(MOBILE);
});

test("mobile top-bar search filters suggestions, keeps pins, and clears only the query", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: null,
        weather: null,
        tubeLines: [],
        signals: [],
      }),
    }),
  );
  const response = await page.goto("/map?food=1");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await page.getByRole("button", { name: "Search the map" }).click();
  // The field suggests pubs as it is typed in, so it is a combobox, not a
  // bare searchbox (components/map/MapSearchSuggest.tsx).
  const search = page.getByRole("combobox", { name: "Search pubs" });
  await expect(search).toBeVisible({ timeout: 20_000 });
  const canvas = page.locator(".mapCanvasWrap");
  await expect.poll(async () => Number(await canvas.getAttribute("data-venue-count")))
    .toBeGreaterThan(0);
  const pinCount = Number(await canvas.getAttribute("data-venue-count"));
  expect(pinCount).toBeGreaterThan(0);
  await search.fill("Definitely no such London pub 987654");

  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expect(page).toHaveURL(/q=Definitely\+no\+such\+London\+pub\+987654/);
  await expect.poll(async () => Number(await canvas.getAttribute("data-venue-count")))
    .toBeGreaterThanOrEqual(pinCount);
  const suggestions = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(suggestions).toBeVisible();
  await expect(suggestions.getByRole("option")).toHaveCount(0);
  await expect(page.getByTestId("map-search-no-results")).toBeVisible();

  await expect(page.locator(".citySuggestBanner, .mapToolbarSearchStatus")).toHaveCount(0);
  await expect(page.locator(".mobileMapChrome > :visible")).toHaveCount(2);

  const clear = page.getByRole("button", { name: "Clear search" });
  const clearBox = await clear.boundingBox();
  expect(clearBox, "Clear search should have a layout box").not.toBeNull();
  expect(Math.round(clearBox?.width ?? 0)).toBeGreaterThanOrEqual(44);
  expect(Math.round(clearBox?.height ?? 0)).toBeGreaterThanOrEqual(44);

  await clear.click();
  await expect(search).toHaveValue("");
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        food: url.searchParams.get("food"),
        query: url.searchParams.get("q"),
      };
    })
    .toEqual({ food: "1", query: null });

  // Suggestions follow the query while map pins keep the food-filtered set.
  await search.fill("German Gymnasium");
  await expect(page).toHaveURL(/q=German\+Gymnasium/);
  await expect(suggestions.getByRole("option", { name: /German Gymnasium/ }).first()).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute("data-venue-count")))
    .toBeGreaterThanOrEqual(pinCount);
});
