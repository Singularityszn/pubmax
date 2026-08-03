import { expect, test, type Locator, type Page } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const DESKTOP_WIDTHS = [1024, 1280, 1440, 1600] as const;
const EDGE_GUTTER = 16;

test.use({ storageState: { cookies: [], origins: [] } });

async function renderedBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) throw new Error(`${label} has no rendered box`);
  return box;
}

async function prepareDesktopMap(page: Page, width = DESKTOP.width) {
  await page.setViewportSize({ width, height: DESKTOP.height });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const width of DESKTOP_WIDTHS) {
  test(`${width}px open planner keeps toolbar search and Clear search beyond the rail edge`, async ({
    page,
  }) => {
    await prepareDesktopMap(page, width);
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

    const response = await page.goto(`/map?desktop-rail-fit=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const toolbar = page.locator(".mapToolbar");
    await expect(toolbar).toBeVisible({ timeout: 20_000 });
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await search.fill("Shoreditch");
    await toolbar.getByRole("button", { name: "Plan tonight" }).click();

    const rail = page.locator(".mapDrawer.left.open");
    const searchCell = toolbar.locator(".mapToolbarSearch");
    const clearSearch = toolbar.getByRole("button", { name: "Clear search" });
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await expect(clearSearch).toBeVisible();
    await expect
      .poll(async () => Math.abs((await rail.boundingBox())?.x ?? -1000), {
        message: "planner rail has finished its slide to the viewport edge",
      })
      .toBeLessThanOrEqual(1);

    const [railBox, toolbarBox, searchBox, clearBox] = await Promise.all([
      renderedBox(rail, "planner rail"),
      renderedBox(toolbar, "desktop toolbar"),
      renderedBox(searchCell, "toolbar search cell"),
      renderedBox(clearSearch, "Clear search"),
    ]);
    const railRight = railBox.x + railBox.width;

    expect(
      toolbarBox.x,
      "desktop toolbar clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      searchBox.x,
      "search cell clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      clearBox.x,
      "Clear search clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      toolbarBox.x + toolbarBox.width,
      "desktop toolbar remains inside viewport",
    ).toBeLessThanOrEqual(width - EDGE_GUTTER);
  });
}

for (const width of DESKTOP_WIDTHS) {
  test(`${width}px first-run location prompt owns centre while status yields to its left`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: DESKTOP.height });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "pubmaxx:analytics-consent:v1",
        "denied",
      );
    });
    await page.route("**/api/citymcp/status**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asOf: "2026-08-03T08:00:00.000Z",
          weather: null,
          tubeLines: [{ line: "Central", status: "Severe delays" }],
          signals: [],
        }),
      }),
    );

    const response = await page.goto(`/map?desktop-first-run-banners=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const locationPrompt = page.locator(".citySuggestBanner");
    const status = page.locator(".cityStatusStack");
    await expect(locationPrompt).toBeVisible({ timeout: 20_000 });
    await expect(status).toBeVisible({ timeout: 20_000 });

    const [locationBox, statusBox] = await Promise.all([
      renderedBox(locationPrompt, "first-run location prompt"),
      renderedBox(status, "city status"),
    ]);
    const locationCentre = locationBox.x + locationBox.width / 2;
    const statusRight = statusBox.x + statusBox.width;

    expect(
      Math.abs(locationCentre - width / 2),
      "location prompt owns map centre",
    ).toBeLessThanOrEqual(1);
    expect(statusBox.x, "status uses left map gutter").toBeCloseTo(
      EDGE_GUTTER,
      0,
    );
    expect(
      statusRight + EDGE_GUTTER,
      "status yields before location prompt's left edge",
    ).toBeLessThanOrEqual(locationBox.x);
  });
}
