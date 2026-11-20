import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`the price-entry route chooses a pub before a blank form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map?log=1");
    const picker = page.locator(".logIntentFallback:visible");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: "Near me", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Search pubs", exact: true })).toBeVisible();
    await picker.locator(".logIntentNearbyBtn").first().click();
    await expect(page.locator('input[inputmode="decimal"]')).toHaveValue("");
  });
}
