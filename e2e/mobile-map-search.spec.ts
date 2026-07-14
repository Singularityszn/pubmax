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

test("mobile map search explains no matches and clears only the query", async ({
  page,
}) => {
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

  const search = page.getByRole("searchbox", { name: /search pubs by name/i });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill("Definitely no such London pub 987654");

  const status = page.locator(".mapToolbarSearchStatus");
  await expect(status).toContainText(
    "No pubs match ‘Definitely no such London pub 987654’ with your current filters.",
  );
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expect(page).toHaveURL(/q=Definitely\+no\+such\+London\+pub\+987654/);

  const suggestionBox = await page.locator(".citySuggestBanner").boundingBox();
  const cameraBox = await page.locator(".mapCameraControls").boundingBox();
  expect(
    suggestionBox,
    "city suggestion should have a layout box",
  ).not.toBeNull();
  expect(cameraBox, "camera controls should have a layout box").not.toBeNull();
  expect(
    cameraBox?.y ?? 0,
    "camera controls should clear the city suggestion",
  ).toBeGreaterThanOrEqual(
    (suggestionBox?.y ?? 0) + (suggestionBox?.height ?? 0),
  );

  const clear = page.locator(".mapToolbarSearchRecovery");
  const clearBox = await clear.boundingBox();
  expect(clearBox, "Clear search should have a layout box").not.toBeNull();
  expect(Math.round(clearBox?.width ?? 0)).toBeGreaterThanOrEqual(44);
  expect(Math.round(clearBox?.height ?? 0)).toBeGreaterThanOrEqual(44);

  await clear.click();
  await expect(search).toHaveValue("");
  await expect(status).toHaveCount(0);
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return {
        food: url.searchParams.get("food"),
        query: url.searchParams.get("q"),
      };
    })
    .toEqual({ food: "1", query: null });

  await search.fill("Arnos Arms");
  await expect(page).toHaveURL(/q=Arnos\+Arms/);
  await expect(status).toHaveCount(0);
});
