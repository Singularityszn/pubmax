import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const path of ["/pubs/venue-18uogns", "/ledger/venue-18uogns"]) {
    test(`${width}px: ${path} shows the price's publisher and read day`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Ye Olde Swiss Cottage", exact: true })).toBeVisible();
      const source = page.locator(".listedPriceSource").first();
      await expect(source.getByRole("link", { name: "Pint Prices", exact: true })).toBeVisible({ timeout: 1_000 });
      await expect(source.locator("time")).toHaveAttribute("datetime", "2026-10-02");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
