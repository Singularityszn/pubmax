import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`home price entry chooses a pub before a blank form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const door = page.getByRole("link", { name: "Log what you paid", exact: true });
    await expect(door).toHaveAttribute("href", "/map?log=1");
    await expect(async () => {
      await door.click();
      await expect(page).toHaveURL(/\/map\?log=1$/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    const picker = page.locator(".logIntentFallback:visible");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: "Near me", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Search pubs", exact: true })).toBeVisible();
    await picker.locator(".logIntentNearbyBtn").first().click();
    await expect(page.locator('input[inputmode="decimal"]')).toHaveValue("");
  });
}
