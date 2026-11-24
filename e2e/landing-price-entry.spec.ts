import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`home opens the map at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const door = page.getByRole("link", { name: "Open the map", exact: true });
    await expect(door).toHaveAttribute("href", "/map");
    await expect(async () => {
      await door.click();
      await expect(page).toHaveURL(/\/map$/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  });
}
