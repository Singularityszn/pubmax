import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("map filters sheet and bottom navigation", () => {
  test("primary tabs stay tappable above an open filters sheet", async ({ page }) => {
    await page.goto("/map");

    await page.getByRole("button", { name: /Filters/i }).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet).toBeVisible();

    const now = primaryNav(page).getByRole("link", { name: "Now", exact: true });
    await expect(now).toBeVisible();
    await now.click({ force: false });

    await expect(page).toHaveURL(/\/(today|tonight)$/);
    await expect(sheet).toHaveCount(0);
  });

  test("analytics consent stays hidden behind an open filters sheet", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    });
    // A real venue answer earns consent. A fresh map alone does not.
    await page.goto("/map?sel=venue-16pnwmm");
    await expect(page.locator(".venueInspector")).toBeVisible();
    await page.getByRole("button", { name: "Close pub detail", exact: true }).click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="venue"]')).toHaveCount(0);

    const consent = page.locator(".analyticsConsentPrompt");
    await expect(consent).toBeVisible();

    await page.getByRole("button", { name: /Filters/i }).click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')).toBeVisible();

    await expect(consent).toBeHidden();
    await page.getByRole("button", { name: "Close Prices and places", exact: true }).click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')).toHaveCount(0);
    await expect(consent).toBeVisible();
  });
});
