import { expect, test, type Page } from "@playwright/test";

// Permanent one-action hierarchy. No build flag changes this contract.

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
      name: "London pints can cost eight quid.",
      exact: true,
    }),
  ).toBeVisible();
}

test.describe("landing Find my pint hierarchy", () => {
  test("keeps one Find my pint primary with Map and Plan as secondary text", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHeroActions");
    await expect(hero).toBeVisible();
    await expect(hero).toHaveClass("lpHeroActions");

    const primaries = hero.locator(".lpButtonPrimary");
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveAttribute("href", "/near?locate=1");
    await expect(primaries.first()).toContainText("Find my pint");

    // No quiet equal-weight button pair under the map-first hero.
    await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);

    const secondary = hero.locator(".lpHeroSecondaryRow");
    await expect(secondary).toBeVisible();
    const mapLink = secondary.getByRole("link", { name: /Open the map/i });
    const planLink = secondary.getByRole("link", { name: /Plan with friends/i });
    await expect(mapLink).toBeVisible();
    await expect(planLink).toBeVisible();
    await expect(mapLink).toHaveClass(/lpTextLink/);
    await expect(planLink).toHaveClass(/lpTextLink/);
    await expect(mapLink).toHaveAttribute("href", "/choose-city");
    await expect(planLink).toHaveAttribute("href", "/plan");
  });

  test("dominant primary stays tappable and above the mobile fold", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });
    const hero = page.locator(".lpHeroActions");
    await expect(hero.getByRole("link", { name: /Find my pint/i })).toHaveAttribute("href", "/near?locate=1");
    await expect(hero.getByRole("link", { name: /Open the map/i })).toHaveAttribute("href", "/choose-city");
    await expect(hero.getByRole("link", { name: /Plan with friends/i })).toHaveAttribute("href", "/plan");
    const primary = hero.locator(".lpButtonPrimary");
    await expect(primary).toHaveCount(1);
    await expect(primary).toContainText("Find my pint");
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(845);
  });
});
