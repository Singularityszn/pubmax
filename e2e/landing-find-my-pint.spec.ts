import { expect, test, type Page } from "@playwright/test";

// DAG L19 — landing hierarchy, shipped flag-OFF (default) behaviour. The flag-ON
// half lives in landing-find-my-pint.flag-on.spec.ts (chromium-flag-on project,
// PUBMAX_LANDING_FIND_MY_PINT=1 build) so neither half needs a runtime test.skip.

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
      name: "Real pint prices on a live map. Plan a crawl your mates will actually walk.",
      exact: true,
    }),
  ).toBeVisible();
}

test.describe("landing Find my pint hierarchy (flag off / default)", () => {
  test("keeps three hero buttons: Find my pint primary, Map and Plan quiet", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHeroActions");
    await expect(hero).toBeVisible();
    await expect(hero).not.toHaveClass(/findMyPint/);

    const buttons = hero.locator(".lpButton");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveClass(/lpButtonPrimary/);
    await expect(buttons.nth(0)).toHaveAttribute("href", "/near");
    await expect(buttons.nth(0)).toContainText("Find my pint");
    await expect(buttons.nth(1)).toHaveClass(/lpButtonQuiet/);
    await expect(buttons.nth(1)).toContainText("Open the map");
    await expect(buttons.nth(2)).toHaveClass(/lpButtonQuiet/);
    await expect(buttons.nth(2)).toContainText("Plan my night");

    // Map and Plan remain reachable; no secondary text demotion while off.
    await expect(hero.locator(".lpHeroSecondaryRow")).toHaveCount(0);
  });

  test("hero primary targets /near and secondary Map/Plan stay linked", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });
    const hero = page.locator(".lpHeroActions");
    await expect(hero.getByRole("link", { name: /Find my pint/i })).toHaveAttribute("href", "/near");
    await expect(hero.getByRole("link", { name: /Open the map/i })).toBeVisible();
    await expect(hero.getByRole("link", { name: /Plan my night/i })).toHaveAttribute("href", "/plan");
    const primary = hero.locator(".lpButtonPrimary");
    await expect(primary).toHaveCount(1);
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
