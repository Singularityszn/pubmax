import { expect, test, type Page } from "@playwright/test";

// One primary action in every build.

async function openLanding(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Listed pint prices on an interactive map. Plan a crawl with your mates.",
      exact: true,
    }),
  ).toBeVisible();
}

test.describe("landing Find my pint hierarchy", () => {
  test("keeps Find my pint primary while Map and Plan stay secondary", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHeroActions");
    await expect(hero).toBeVisible();
    await expect(hero).toHaveClass("lpHeroActions");

    const primary = hero.locator(".lpButtonPrimary");
    await expect(primary).toHaveCount(1);
    await expect(primary).toHaveAttribute("href", "/near?locate=1");
    await expect(primary).toContainText("Find my pint");
    await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);

    const secondary = hero.locator(".lpHeroSecondaryRow");
    await expect(secondary.getByRole("link", { name: /Open the map/i })).toBeVisible();
    await expect(secondary.getByRole("link", { name: /Plan my night/i })).toBeVisible();
  });

  test("hero primary targets /near and secondary Map/Plan stay linked", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });
    const hero = page.locator(".lpHeroActions");
    await expect(hero.getByRole("link", { name: /Find my pint/i })).toHaveAttribute("href", "/near?locate=1");
    await expect(hero.getByRole("link", { name: /Open the map/i })).toBeVisible();
    await expect(hero.getByRole("link", { name: /Plan my night/i })).toHaveAttribute("href", "/plan");
    const primary = hero.locator(".lpButtonPrimary");
    await expect(primary).toHaveCount(1);
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
