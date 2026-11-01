import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const [width, theme] of [[320, "light"], [390, "dark"], [1440, "light"]] as const) {
  test(`${width}px: listed food and drink basket works with analytics consent denied`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("pubmax-theme", selectedTheme);
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const events: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/events") events.push(request.method()); });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?sel=venue-1hz0avt");
    const menu = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(async () => {
      await menu.click();
      await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
    }).toPass({ timeout: 45_000 });
    const basket = page.locator(".menuBasket");
    await basket.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(basket).toHaveAttribute("open", "");
    const choices = await basket.locator("select option[value]:not([value=''])").evaluateAll((options) => options.map((option) => ({ id: (option as HTMLOptionElement).value, text: option.textContent ?? "" })));
    const food = choices.find((choice) => choice.id.startsWith("food:"));
    const drink = choices.find((choice) => choice.id.startsWith("drink:"));
    expect(food).toBeTruthy(); expect(drink).toBeTruthy();
    const expectedPence = [food!, drink!].reduce((sum, choice) => sum + Math.round(Number(choice.text.match(/£([0-9.]+)/)?.[1]) * 100), 0);
    expect(expectedPence).toBeGreaterThan(0);
    await basket.getByRole("combobox", { name: "Add an item" }).selectOption(food!.id);
    await basket.getByRole("combobox", { name: "Add an item" }).selectOption(drink!.id);
    await expect(basket.getByRole("status")).toContainText(`£${(expectedPence / 100).toFixed(2)}`);
    await expect(basket.getByRole("status")).toContainText("Full cost unknown");
    const quantities = basket.getByRole("spinbutton");
    const itemPence = [food!, drink!].map((choice) => Math.round(Number(choice.text.match(/£([0-9.]+)/)?.[1]) * 100));
    for (const index of [0, 1]) {
      const input = quantities.nth(index);
      await input.focus();
      await input.press("ArrowRight");
      await input.press("Backspace");
      await expect(quantities).toHaveCount(2);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("");
      await expect(basket.getByRole("status")).toContainText("Menu subtotal: Incomplete");
      await expect(basket.getByRole("status")).not.toContainText("£");
      await input.press("2");
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("2");
      await expect(basket.getByRole("status")).toContainText(`£${((expectedPence + itemPence[index]) / 100).toFixed(2)}`);
      await input.fill("1");
    }
    await expect(basket.locator("time").first()).toBeVisible();
    expect(await basket.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await basket.screenshot({ path: test.info().outputPath(`basket-${width}.png`) });
    await basket.getByRole("button", { name: "Clear items" }).click();
    await expect(basket.getByRole("status")).toContainText("Choose an item");
    expect(events).toEqual([]);
  });
}
