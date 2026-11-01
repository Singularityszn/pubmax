import { expect, test, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapToolbarReady, selectFirstToolbarVenue } from "./helpers/mapToolbar";
import { desktopVenueDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

const VIEWPORT = { width: 390, height: 844 };

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("no-alcohol and food views own the 390px map without pint controls", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The phone chrome mounts with the SCENE, not with the document, and warming
  // the map up regularly outlasts the 10s expect budget on a cold server. That
  // is a wait on the map, not a finding about this view, so it gets the same
  // generous first-paint budget every other mobile map spec takes.
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  const mapViewGroup = sheet.getByRole("group", { name: "Map view" });
  const all = mapViewGroup.getByRole("button", { name: "All", exact: true });
  const noAlcohol = mapViewGroup.getByRole("button", {
    name: "No alcohol",
    exact: true,
  });
  const food = mapViewGroup.getByRole("button", { name: "Food", exact: true });
  for (const control of [all, noAlcohol, food]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 390) + (box?.width ?? 1)).toBeLessThanOrEqual(390);
  }

  const indexResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
      candidate.status() === 200,
  );
  await noAlcohol.click();
  await indexResponse;
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /alcohol-free or soft drink prices/i,
  );
  await expect(
    sheet.getByRole("button", { name: "Beer", exact: true }),
  ).toHaveCount(0);
  await expect(sheet.getByText("Maximum pint price")).toHaveCount(0);
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: no-alcohol view active",
  );

  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  // The map counts only its sourced anchors. Venue menus can hold dish prices
  // even when no food anchor is painted, so the empty map points to Menu.
  await expect(sheet.getByRole("status")).toHaveText(
    /^(?:Food venues shown\. Open Menu for dish prices we have\.|\d+ menu prices? we have shown\.)$/,
  );
  await expect(
    page.getByRole("button", { name: "Pints", exact: true }),
  ).toHaveCount(0);
  const foodKinds = sheet.getByRole("group", { name: "Venue types" });
  await expect(foodKinds.getByRole("button", { name: "Pubs", exact: true })).toBeVisible();
  await expect(foodKinds.getByRole("button", { name: "Bars", exact: true })).toBeVisible();
  await expect(
    sheet
      .getByRole("group", { name: "Venue types" })
      .getByRole("button", { name: "Food", exact: true }),
  ).toBeVisible();
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: food view active",
  );

  expect(errors).toEqual([]);
});

for (const { width, height } of [
  { width: 641, height: 900 },
  { width: 800, height: 900 },
  { width: 900, height: 900 },
  { width: 1440, height: 582 },
  { width: 1440, height: 900 },
]) {
  test("desktop filters fit and execute at " + width + "x" + height, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await installDeterministicMapBasemap(page);
    await page.goto("/map");
    await expectMapToolbarReady(page);
    const toolbar = page.locator(".mapToolbar");
    const toggle = toolbar.locator(".mapVenueKindFilterBtn");
    await toggle.click();
    const panel = toolbar.getByRole("dialog", { name: "Filters", exact: true });
    await expect(panel).toBeVisible();
    const kinds = panel.getByRole("group", { name: "Venue types" });
    await kinds.getByRole("button", { name: "Bars", exact: true }).click();
    await kinds.getByRole("button", { name: "Restaurants", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-label", /2 filters on/);
    await expect(toggle.locator(".mapVenueKindFilterCount")).toHaveText("2");
    if (width <= 900) await expect(toggle.locator(".mapVenueKindFilterWord")).toBeHidden();
    else await expect(toggle.locator(".mapVenueKindFilterWord")).toBeVisible();
    const box = await panel.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const reset = panel.getByRole("button", { name: "Show all types", exact: true });
    await reset.scrollIntoViewIfNeeded();
    await expect.poll(() => reset.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    })).toBe(true);
    await reset.click();
    await expect(toggle).toHaveAttribute("aria-label", "Filters: venue types, view and zone, pub features");
    const views = panel.getByRole("group", { name: "Map view" });
    for (const label of ["All", "No alcohol", "Food"]) {
      const control = views.getByRole("button", { name: label, exact: true });
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
      const panelAfter = await panel.boundingBox();
      expect(panelAfter!.x).toBeGreaterThanOrEqual(0);
      expect(panelAfter!.x + panelAfter!.width).toBeLessThanOrEqual(width);
      await expect.poll(() => control.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
      if (label !== "All") {
        await expect(toolbar.getByRole("button", { name: /^Drink:/ })).toHaveCount(0);
        await expect(toolbar.locator(".drinkShapeChips")).toHaveCount(0);
      }
    }
  });
}

test("the desktop inspector retains the selected coffee category", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeterministicMapBasemap(page);
  await page.goto("/map");
  await expectMapToolbarReady(page);
  await selectFirstToolbarVenue(page, "Princess Louise");
  await expectSoleDesktopDrawer(page, "venue");
  const toolbar = page.locator(".mapToolbar");
  await toolbar.getByRole("button", { name: /^Drink:/ }).click();
  await toolbar.getByRole("button", { name: "Coffee", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: /^Drink:/ })).toContainText("Coffee");
  await expect(desktopVenueDrawer(page).locator(".venueDrinkPrices")).toContainText(/coffee/i);
  await expect(desktopVenueDrawer(page).locator(".venuePriceThen")).toHaveCount(0);
});
