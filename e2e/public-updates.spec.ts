import { expect, test } from "@playwright/test";

test("a signed-out phone reader can open released updates from You", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/u/you");
  await page.getByRole("link", { name: "Updates", exact: true }).click();
  await expect(page).toHaveURL(/\/updates$/);
  await expect(page.getByRole("heading", { name: "What's changed", exact: true })).toBeVisible();
  await expect(page.locator("main time")).toHaveAttribute("datetime", "2026-10-19");
  await expect(page.locator("main time")).toHaveText("19 October 2026");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pubmaxxing.com/updates");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole("link", { name: "Open the map", exact: true }).click();
  await expect(page).toHaveURL(/\/map$/);
});
