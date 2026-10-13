import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`${width}px ${theme}: summary notes expose scoped evidence and real source doors`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("pubmax-theme", selectedTheme);
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      await installDeterministicMapBasemap(page);
      await page.goto("/pal/chat");
      const tonight = page.getByRole("note", { name: "Tonight at a glance", exact: true });
      const price = page.getByRole("note", { name: "Listed price nearby", exact: true });
      await expect(tonight).toBeVisible();
      await expect(tonight.locator(".palGlanceLine")).toContainText("In our London listings tonight:");
      await expect(tonight.locator(".palGlanceReceipt")).toContainText(/Sources: .+\./);
      await expect(tonight.locator(".palGlanceReceipt")).toContainText(/Oldest listing observed|Listing read date unknown/);
      await expect(tonight.getByRole("link", { name: "See listings and sources.", exact: true })).toHaveAttribute("href", "/tonight");
      await expect(price).toContainText("£2.95 at The Three Tuns - LSE Student Union");
      await expect(price.locator(".palGlanceLine")).toContainText(/Lowest listed price|Listed price around/);
      await expect(price.locator(".palGlanceReceipt")).toContainText("Pint Prices");
      await expect(price.locator(".palGlanceReceipt")).toContainText("Source read 2 October 2026");
      await expect(price).toContainText("Serving size, offer and entry terms are not recorded.");
      await price.scrollIntoViewIfNeeded();
      const layout = await price.locator(".palGlanceReceipt").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, content: element.scrollWidth, available: element.clientWidth, document: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width + 1);
      expect(layout.content).toBeLessThanOrEqual(layout.available + 1);
      expect(layout.document).toBeLessThanOrEqual(layout.viewport);
      const venue = price.getByRole("link", { name: "Price source and venue details.", exact: true });
      await expect(venue).toHaveAttribute("href", "/map?sel=venue-p7p18j");
      if (width === 1440 && theme === "light") {
        await venue.click();
        await expect(page).toHaveURL(/\/map\?sel=venue-p7p18j$/);
        await expect(page.getByRole("tab", { name: "Menu", exact: true })).toBeVisible({ timeout: 45_000 });
        await page.goBack();
        await expect(tonight).toBeVisible();
        await tonight.getByRole("link", { name: "See listings and sources.", exact: true }).click();
        await expect(page).toHaveURL(/\/tonight$/);
      }
    });
  }
}
