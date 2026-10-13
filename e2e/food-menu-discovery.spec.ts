import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [320, 390, 430, 1440]) {
  test(`${width}px: the recorded Food menu is reachable and returns to its own button`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installDeterministicMapBasemap(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/map?sel=venue-1hz0avt");
    const menuTab = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(menuTab).toBeVisible({ timeout: 45_000 });
    await expect(async () => {
      await menuTab.click();
      await expect(menuTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const panel = page.locator("#venuePanel-menu");
    const food = panel.getByRole("button", { name: "Food 42 dishes on record", exact: true });
    const drinks = panel.getByRole("button", { name: "Drinks 1 on record", exact: true });
    await expect(food).toBeVisible();
    await expect(drinks).toBeVisible();
    await drinks.focus();
    await page.keyboard.press("Tab");
    await expect(food).toBeFocused();
    await food.click();
    const back = panel.getByRole("button", { name: "Back to menus", exact: true });
    await expect(back).toBeFocused();
    await expect(panel.locator(".drinkRow")).toHaveCount(42);
    await expect(panel.locator(".foodCalories")).toHaveCount(42);
    const firstCalories = panel.locator(".foodCalories").first();
    await expect(firstCalories).toContainText(/\d+ kcal on the menu/);
    const firstRow = panel.locator(".drinkRow").first();
    if (width <= 640) {
      const rowWidth = (await firstRow.boundingBox())!.width;
      const nameWidth = (await firstRow.locator(".drinkName").boundingBox())!.width;
      expect(nameWidth).toBeGreaterThanOrEqual(rowWidth * 0.6);
    }
    await expect(firstRow.locator("a")).toHaveCount(1);
    await expect(firstRow.locator("a")).toHaveAttribute("href", "https://www.theeaglew12.co.uk/food-drink");
    await expect(firstRow.locator("time")).toContainText("13 October 2026");
    await expect(firstRow.locator(".drinkRowSide")).toContainText("Price and calories");
    await back.click();
    await expect(food).toBeFocused();
    await expect(panel.locator(".drinkRow")).toHaveCount(0);
    const geometry = await food.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { x: box.x, right: box.right, width: box.width, height: box.height, ownsCentre: element.contains(centre) };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.ownsCentre).toBe(true);
    expect(errors).toEqual([]);
  });
}
