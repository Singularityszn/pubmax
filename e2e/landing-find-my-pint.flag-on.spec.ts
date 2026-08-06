import { expect, test, type Page } from "@playwright/test";

// DAG L19 flag-ON half, split out of landing-find-my-pint.spec.ts so neither
// half needs a runtime test.skip (L20 zero-skip contract). This file runs only
// in the chromium-flag-on project, whose webServer is built with
// PUBMAX_LANDING_FIND_MY_PINT=1 — so "Find my pint" is the sole primary and
// Map/Plan demote to secondary text links. The shipped flag-off hierarchy is
// asserted in landing-find-my-pint.spec.ts (default suite).

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
      name: "Listed pint prices for nights out.",
      exact: true,
    }),
  ).toBeVisible();
}

test("makes Find my pint the sole primary; Map and Plan are secondary text", async ({ page }) => {
  await openLanding(page, { width: 1440, height: 900 });

  const hero = page.locator(".lpHeroActions");
  await expect(hero).toHaveClass(/lpHeroActions--findMyPint/);

  const primaries = hero.locator(".lpButtonPrimary");
  await expect(primaries).toHaveCount(1);
  await expect(primaries.first()).toHaveAttribute("href", "/near");
  await expect(primaries.first()).toContainText("Find my pint");

  // No quiet equal-weight pair under the hero.
  await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);

  const secondary = hero.locator(".lpHeroSecondaryRow");
  await expect(secondary).toBeVisible();
  const mapLink = secondary.getByRole("link", { name: /Open the map/i });
  const planLink = secondary.getByRole("link", { name: /Plan my night/i });
  await expect(mapLink).toBeVisible();
  await expect(planLink).toBeVisible();
  await expect(mapLink).toHaveClass(/lpTextLink/);
  await expect(planLink).toHaveClass(/lpTextLink/);
  await expect(planLink).toHaveAttribute("href", "/plan");
});

test("dominant primary stays above the fold on desktop and mobile", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ] as const) {
    await openLanding(page, viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".lp.lp--findMyPint")).toHaveCount(1);
    const primary = page.locator(".lpHeroActions--findMyPint .lpButtonPrimary");
    await expect(primary).toBeVisible();
    const box = await primary.boundingBox();
    expect(box).not.toBeNull();
    // Flag-on primary must fully fit the first screen (L19 browser proof).
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);
    // No equal-weight Map/Plan button pair on mobile.
    await expect(page.locator(".lpHeroActions .lpButtonQuiet")).toHaveCount(0);
  }
});
