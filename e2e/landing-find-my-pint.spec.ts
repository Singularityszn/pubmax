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
      name: "London pints can cost eight quid.",
      exact: true,
    }),
  ).toBeVisible();
}

test.describe("landing Find my pint hierarchy (flag off / default)", () => {
  test("keeps the map-first hero: Open the map primary, Find my pint and Plan secondary text", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHeroActions");
    await expect(hero).toBeVisible();
    await expect(hero).toHaveClass(/lpHeroActions--mapFirst/);
    await expect(hero).not.toHaveClass(/findMyPint/);

    const primaries = hero.locator(".lpButtonPrimary");
    await expect(primaries).toHaveCount(1);
    // No preferred city stored in a fresh session, so primaryCtaHref falls
    // back to the city chooser rather than a fixed map route.
    await expect(primaries.first()).toHaveAttribute("href", "/choose-city");
    await expect(primaries.first()).toContainText("Open the map");

    // No quiet equal-weight button pair under the map-first hero.
    await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);

    const secondary = hero.locator(".lpHeroSecondaryRow");
    await expect(secondary).toBeVisible();
    const findLink = secondary.getByRole("link", { name: /Find my pint/i });
    const planLink = secondary.getByRole("link", { name: /Plan with friends/i });
    await expect(findLink).toBeVisible();
    await expect(planLink).toBeVisible();
    await expect(findLink).toHaveClass(/lpTextLink/);
    await expect(planLink).toHaveClass(/lpTextLink/);
    await expect(findLink).toHaveAttribute("href", "/near");
    await expect(planLink).toHaveAttribute("href", "/plan");
  });

  test("hero primary targets the map and secondary Find my pint/Plan stay linked", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });
    const hero = page.locator(".lpHeroActions");
    await expect(hero.getByRole("link", { name: /Find my pint/i })).toHaveAttribute("href", "/near");
    await expect(hero.getByRole("link", { name: /Plan with friends/i })).toHaveAttribute("href", "/plan");
    const primary = hero.locator(".lpButtonPrimary");
    await expect(primary).toHaveCount(1);
    await expect(primary).toContainText("Open the map");
    const box = await primary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
