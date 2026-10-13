import { expect, test, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapToolbarReady, selectFirstToolbarVenue } from "./helpers/mapToolbar";
import { desktopVenueDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

// Desktop map chrome beside an open pub drawer (QA journeys F04). The drawer's
// focus trap used to make the whole toolbar inert while the bar was drawn at
// full strength, so Search, Filters and the drink button took no click, and a
// drink tray opened first stayed open over the mapped route. The toolbar is an
// exempt surface of that trap from 1024px, and the tray closes when a drawer
// opens. The tray may still be reopened beside the drawer, in the free lane.

async function openDesktopMap(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expectMapToolbarReady(page);
}

const toolbarIsInert = (page: Page) =>
  page.locator(".mapToolbar").evaluate((node) => node.closest("[inert]") !== null);

test.describe("desktop toolbar beside the venue drawer", () => {
  test("stays live, and the drink tray closes when the drawer opens", async ({ page }) => {
    test.setTimeout(180_000);
    await openDesktopMap(page, 1440);

    const toolbar = page.locator(".mapToolbar");
    const drinkButton = toolbar.getByRole("button", { name: /^Drink:/ });
    await drinkButton.click();
    await expect(page.locator(".drinkLanePicker")).toBeVisible();

    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");

    // The tray gave way to the drawer it would have sat beside.
    await expect(page.locator(".drinkLanePicker")).toHaveCount(0);
    await expect(drinkButton).toHaveAttribute("aria-expanded", "false");

    // The bar takes pointer and focus, and the drawer says it is not modal.
    await expect.poll(() => toolbarIsInert(page)).toBe(false);
    await expect(desktopVenueDrawer(page)).not.toHaveAttribute("aria-modal", "true");

    // Reopened beside the drawer, the tray works and clears the drawer's edge.
    await drinkButton.click();
    const tray = page.locator(".drinkLanePicker");
    await expect(tray).toBeVisible();
    // One set of drink choices (F24): no second strip of chips under the tabs,
    // and the eleven tabs share a row at 1440 instead of "Shots" alone below.
    await expect(page.locator(".mapToolbar .drinkShapeChips")).toHaveCount(0);
    const tops = await tray
      .locator(".drinkLanePickerOption")
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(tops.length).toBe(11);
    expect(new Set(tops).size).toBe(1);

    const wine = tray.getByRole("button", { name: "Wine", exact: true });
    await wine.click();
    await expect(wine).toHaveAttribute("aria-pressed", "true");

    const trayBox = await page.locator(".mapToolbar").boundingBox();
    const drawerBox = await desktopVenueDrawer(page).boundingBox();
    expect(trayBox).not.toBeNull();
    expect(drawerBox).not.toBeNull();
    expect(trayBox!.x + trayBox!.width).toBeLessThanOrEqual(drawerBox!.x);
  });

  test("Filters opens beside the drawer", async ({ page }) => {
    test.setTimeout(180_000);
    await openDesktopMap(page, 1440);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");

    const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
  });
});

for (const width of [1024, 1140, 1440]) {
  test(`search and dismiss controls remain reachable beside a pub at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await openDesktopMap(page, width);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");
    const toolbar = page.locator(".mapToolbar");
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await expect.poll(async () => search.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.left >= 0 && rect.width >= 176 && rect.right <= innerWidth && hit === node;
    })).toBe(true);
    await search.click();
    await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
    await toolbar.getByRole("button", { name: "Close search results" }).click();
    await expect(search).toHaveValue("Princess Louise");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await search.click();
    await toolbar.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toHaveAttribute("aria-expanded", "false");

    const drink = toolbar.getByRole("button", { name: /^Drink:/ });
    await drink.click();
    await toolbar.getByRole("button", { name: "Close drink choices" }).click();
    await expect(drink).toHaveAttribute("aria-expanded", "false");
    await expect(drink).toBeFocused();
    await drink.click();
    await page.keyboard.press("Escape");
    await expect(drink).toHaveAttribute("aria-expanded", "false");
    await expectSoleDesktopDrawer(page, "venue");

    await page.getByRole("button", { name: "Close pub detail", exact: true }).click();
    await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
    await selectFirstToolbarVenue(page, "Blackfriar");
    await expectSoleDesktopDrawer(page, "venue");
    await page.getByRole("button", { name: "Close pub detail", exact: true }).click();
    await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
  });
}
