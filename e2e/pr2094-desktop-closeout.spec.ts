import { expect, test } from "@playwright/test";

import { expectMapToolbarReady, selectFirstToolbarVenue } from "./helpers/mapToolbar";
import { expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

test.use({ serviceWorkers: "block" });

for (const width of [1024, 1440]) {
  test(`desktop search dismissal and focus beside an open pub at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/map");
    await expectMapToolbarReady(page);
    await selectFirstToolbarVenue(page, "Princess Louise");
    await expectSoleDesktopDrawer(page, "venue");
    const selected = new URL(page.url()).searchParams.get("sel");
    const toolbar = page.locator(".mapToolbar");
    const search = toolbar.getByRole("combobox", { name: "Search pubs", exact: true });
    const suggestions = page.getByRole("listbox", { name: "Search suggestions", exact: true });
    const drink = toolbar.getByRole("button", { name: /^Drink:/ });

    await test.step("Close preserves the search and returns focus", async () => {
      await search.click();
      await expect(suggestions).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("01-search-open.png") });
      await toolbar.getByRole("button", { name: "Close search results", exact: true }).click();
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(search).toHaveValue("Princess Louise");
      await expect(search).toBeFocused();
    });

    await test.step("Escape preserves the search and the selected pub", async () => {
      await search.click();
      await expect(suggestions).toBeVisible();
      await search.press("Escape");
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(search).toHaveValue("Princess Louise");
      await expect(search).toBeFocused();
      await expectSoleDesktopDrawer(page, "venue");
      expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
    });

    await test.step("An outside click closes search and leaves toolbar panels usable", async () => {
      await search.click();
      await expect(suggestions).toBeVisible();
      const theme = page.getByRole("button", { name: /^Switch to .* theme$/ });
      const previousTheme = await theme.getAttribute("aria-label");
      await theme.click();
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(search).toHaveValue("Princess Louise");
      await expect(theme).not.toHaveAttribute("aria-label", previousTheme!);
      await expectSoleDesktopDrawer(page, "venue");
      expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
      await drink.click();
      await expect(drink).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".drinkLanePicker")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("02-outside-click-drink-panel.png") });
      await toolbar.getByRole("button", { name: "Close drink choices", exact: true }).click();
      await expect(drink).toBeFocused();
      await expectSoleDesktopDrawer(page, "venue");
      expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
    });

    await test.step("A palette backdrop click restores its opener and leaves the pub open", async () => {
      const opener = page.getByRole("button", { name: "Open command palette", exact: true });
      await opener.click();
      const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
      await expect(palette).toBeVisible();
      const commandSearch = palette.getByRole("combobox", { name: "Search commands", exact: true });
      await expect(commandSearch).toBeFocused();
      await commandSearch.click();
      await commandSearch.fill("Map");
      await expect(commandSearch).toHaveValue("Map");
      await expect(palette).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("03-palette-open.png") });
      await page.locator(".cmdkBackdrop").click({ position: { x: 8, y: 8 } });
      await expect(palette).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expectSoleDesktopDrawer(page, "venue");
      expect(new URL(page.url()).searchParams.get("sel")).toBe(selected);
      await page.screenshot({ path: testInfo.outputPath("04-palette-dismissed.png") });
    });

    expect(errors).toEqual([]);
  });
}
