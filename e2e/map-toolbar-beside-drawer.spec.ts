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

async function openDesktopMap(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
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
  test.use({ serviceWorkers: "block" });
  test("visible site navigation stays usable while a pub is open", async ({ page }) => {
    await openDesktopMap(page, 1440);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");
    const selected = new URL(page.url()).searchParams.get("sel");
    const nav = page.locator('.siteNavBar[aria-label="Site navigation"]');
    await expect.poll(() => nav.evaluate((node) => node.closest("[inert]") !== null)).toBe(false);
    const theme = nav.getByRole("button", { name: /^Switch to .* theme$/ });
    const themeName = await theme.getAttribute("aria-label");
    await theme.click();
    await expect(theme).not.toHaveAttribute("aria-label", themeName!);
    await expectSoleDesktopDrawer(page, "venue");
    const more = nav.getByRole("button", { name: "More pages", exact: true });
    await more.click();
    const menu = page.getByRole("menu", { name: "More pages", exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate((node) => node.closest("[inert]") !== null)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await expectSoleDesktopDrawer(page, "venue");
    const commands = nav.getByRole("button", { name: "Open command palette", exact: true });
    await commands.click();
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await expect(palette).toBeVisible();
    await expect.poll(() => nav.evaluate((node) => node.closest("[inert]") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(commands).toBeFocused();
    await expect.poll(() => nav.evaluate((node) => node.closest("[inert]") !== null)).toBe(false);
    await expectSoleDesktopDrawer(page, "venue");
    expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
  });

  test("Escape cancels a delayed palette and an immediate reopen beside a pub", async ({ page }) => {
    await openDesktopMap(page, 1440);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");
    const selected = new URL(page.url()).searchParams.get("sel");
    const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
    await search.fill("Eagle");
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    const delayed: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Register after the map loads so hashed production chunks work too.
    await page.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
      delayed.push(route.request().url());
      await gate;
      await route.continue();
    });
    try {
      await test.step("cancel while the actual module is still downloading", async () => {
        await search.press("Control+k");
        await expect.poll(() => delayed.length).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        await expect(search).toHaveValue("Eagle");
        await expect(search).toBeFocused();
        const response = page.waitForResponse((result) => delayed.includes(result.url()));
        release();
        await response;
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(palette).toHaveCount(0);
        await expect(search).toBeFocused();
        await expectSoleDesktopDrawer(page, "venue");
        expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
      });
      await test.step("close an immediate reopen during its focus handoff", async () => {
        await search.press("Control+k");
        await expect(palette).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(palette).toHaveCount(0);
        await expect(search).toBeFocused();
        await expect(search).toHaveValue("Eagle");
        await expectSoleDesktopDrawer(page, "venue");
        expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
      });
    } finally {
      release();
    }
  });

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

  test("Escape from the search Close button preserves the open pub", async ({ page }) => {
    test.setTimeout(180_000);
    await openDesktopMap(page, 1440);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");
    const toolbar = page.locator(".mapToolbar");
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await search.click();
    const close = toolbar.getByRole("button", { name: "Close search results" });
    await expect(close).toBeVisible();
    await search.press("Tab");
    await expect(toolbar.getByRole("button", { name: "Clear search", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    const selected = new URL(page.url()).searchParams.get("sel");
    await page.keyboard.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(search).toHaveValue("Princess Louise");
    await expect(search).toBeFocused();
    await expectSoleDesktopDrawer(page, "venue");
    expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
  });

  for (const popup of ["Filters", "City"] as const) {
    test(`Escape closes keyboard-opened ${popup} before the drink tray`, async ({ page }) => {
      test.setTimeout(180_000);
      await openDesktopMap(page, 1440);
      await selectFirstToolbarVenue(page, "Princess Louise");
      await expectSoleDesktopDrawer(page, "venue");
      const toolbar = page.locator(".mapToolbar");
      const drink = toolbar.getByRole("button", { name: /^Drink:/ });
      const trigger = popup === "Filters"
        ? toolbar.locator(".mapVenueKindFilterBtn")
        : toolbar.getByRole("button", { name: /^Map area:/ });
      await drink.click();
      await expect(drink).toHaveAttribute("aria-expanded", "true");
      // Keyboard activation keeps the underlying tray open without firing its
      // outside-pointer dismissal, so Escape must choose the newer popup.
      await trigger.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(drink).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toBeFocused();
      await expect(drink).toHaveAttribute("aria-expanded", "true");
      await expectSoleDesktopDrawer(page, "venue");
      await page.keyboard.press("Escape");
      await expect(drink).toHaveAttribute("aria-expanded", "false");
      await expect(drink).toBeFocused();
      await expectSoleDesktopDrawer(page, "venue");
    });
  }
});

for (const { width, height } of [
  { width: 1024, height: 768 },
  { width: 1140, height: 900 },
  { width: 1362, height: 582 },
  { width: 1440, height: 900 },
]) {
  test(`search and dismiss controls remain reachable beside a pub at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(180_000);
    await openDesktopMap(page, width, height);
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

    await page.getByRole("button", { name: /^Close (?:pub|venue) detail$/ }).click();
    await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
    await selectFirstToolbarVenue(page, "Blackfriar");
    await expectSoleDesktopDrawer(page, "venue");
    await page.getByRole("button", { name: /^Close (?:pub|venue) detail$/ }).click();
    await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
  });
}
