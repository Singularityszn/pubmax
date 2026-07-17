import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectContainedInSheetBody,
  mockScrollableMobileSheets,
} from "./support/mobileMapSheets";

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

async function sheetGeometry(sheet: Locator) {
  return sheet.evaluate((node) => {
    const title = node.querySelector("h2");
    const body = node.querySelector(".mobileSharedSheetBody");
    const titleStyle = title ? getComputedStyle(title) : null;
    const bodyStyle = body ? getComputedStyle(body) : null;
    return {
      radius: getComputedStyle(node).borderTopLeftRadius,
      titleFont: titleStyle?.fontFamily,
      titleSize: titleStyle?.fontSize,
      bodyFont: bodyStyle?.fontFamily,
      bodySize: bodyStyle?.fontSize,
      bodyLineHeight: bodyStyle?.lineHeight,
    };
  });
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
  await expect(topbar.locator(".mobileMapCity")).toHaveText("London");
  await expectTapTarget(topbar.getByRole("button", { name: "Search the map" }), "map search action");
  await topbar.getByRole("button", { name: "Search the map" }).click();
  const searchInput = page.getByRole("searchbox", { name: "Search pubs" });
  await expect(searchInput).toBeVisible();
  await expectTapTarget(searchInput.locator(".."), "map search field");

  await topbar.getByRole("button", { name: "Search the map" }).click();
  const drinks = page.getByRole("button", { name: "Drinks", exact: true });
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

  const category = filters.getByLabel("Drink category");
  await expect(category).toBeVisible();
  await category.selectOption("gin");
  await expect(filters.getByLabel("Gin brand")).toBeVisible();
  await filters.getByRole("button", { name: "Close Drinks and price" }).click();

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

  await layers.getByRole("button", { name: "Close Map layers" }).click();
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

test("Tonight and TfL stay contained and navigable in the mobile sheet", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "light");
    window.localStorage.setItem("pubmax-mode", "lock-in");
    window.localStorage.setItem("pubmax-legacy", "0");
  });
  await mockScrollableMobileSheets(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

  await page.getByRole("button", { name: /Tonight/ }).click();
  const tonightSheet = page.locator('.mobileSheetPortal[data-sheet-kind="tonight"]');
  await expect(tonightSheet).toBeVisible();
  await expect(tonightSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
  const tonightBody = tonightSheet.locator(".mobileSharedSheetBody");
  const tonightLane = tonightBody.locator(".tonightLane--open");
  await expect(tonightLane).toBeVisible();
  await expect(tonightSheet.getByRole("button", { name: "Close Tonight" })).toHaveCount(1);
  await expect(tonightSheet.getByRole("button", { name: "Collapse on tonight" })).toHaveCount(0);
  await expectContainedInSheetBody(tonightLane);
  const laneScroller = tonightSheet.locator(".tonightLaneScroll");
  await laneScroller.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await expect.poll(() => laneScroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await laneScroller.locator(".tonightLaneCardTap").first().click();
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
  await venueSheet.locator(".mobileSharedSheetClose").click();

  await page.getByRole("button", { name: /TfL/ }).click();
  const tflSheet = page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]');
  await expect(tflSheet).toBeVisible();
  await expect(tflSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
  const tflBody = tflSheet.locator(".mobileSharedSheetBody");
  await expect(tflBody).toHaveCSS("overflow-y", "auto");
  const scrollRange = await tflBody.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(scrollRange).toBeGreaterThan(0);
  const tflBox = await tflBody.boundingBox();
  expect(tflBox).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: Math.round((tflBox?.x ?? 0) + (tflBox?.width ?? 0) / 2),
    y: Math.round((tflBox?.y ?? 0) + Math.min((tflBox?.height ?? 0) / 2, 220)),
    yDistance: -Math.min(scrollRange, 600),
    gestureSourceType: "touch",
    speed: 800,
  });
  await expect.poll(() => tflBody.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await tflBody.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const lastLine = tflSheet.getByText("Test line 14");
  await expect(lastLine).toBeInViewport();
  const lastLineBottom = await lastLine.evaluate((node) => node.getBoundingClientRect().bottom);
  const bodyBottom = await tflBody.evaluate((node) => node.getBoundingClientRect().bottom);
  expect(lastLineBottom).toBeLessThanOrEqual(bodyBottom + 1);
  await tflSheet.getByRole("button", { name: "Close TfL live" }).click();

  await page.getByRole("button", { name: "More map controls" }).click();
  const layersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  const poiGroup = layersSheet.getByRole("group", { name: "Points of interest" });
  await expect(poiGroup.getByRole("button", { name: "Tube" })).toHaveAttribute("aria-pressed", "true");
  await expect(poiGroup.getByRole("button", { name: "Rail" })).toHaveAttribute("aria-pressed", "true");
  const layerTabs = layersSheet.getByRole("tablist", { name: "Layer settings sections" });
  await layerTabs.getByRole("tab", { name: "Transit" }).click();
  const tubeNetwork = layersSheet.getByRole("button", { name: "Tube network" });
  await expectTapTarget(tubeNetwork, "Tube network control");
  await expect(tubeNetwork).toHaveAttribute("aria-pressed", "false");
  await tubeNetwork.click();
  await expect(tubeNetwork).toHaveAttribute("aria-pressed", "true");
  await layerTabs.getByRole("tab", { name: "Layers" }).click();
  const sharedSheet = layersSheet.locator(".mobileSharedSheet");
  const lightGeometry = await sheetGeometry(sharedSheet);
  await layersSheet.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkGeometry = await sheetGeometry(sharedSheet);
  expect(darkGeometry).toEqual(lightGeometry);
  await layerTabs.getByRole("tab", { name: "Transit" }).click();
  await expect(tubeNetwork).toHaveAttribute("aria-pressed", "true");
  await layersSheet.getByRole("button", { name: "Close Map layers" }).click();

  await page.getByRole("button", { name: /Tonight/ }).click();
  const darkTonightLane = page.locator('.mobileSheetPortal[data-sheet-kind="tonight"] .tonightLane--open');
  await expectContainedInSheetBody(darkTonightLane);
});
