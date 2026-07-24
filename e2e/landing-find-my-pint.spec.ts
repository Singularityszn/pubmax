import { expect, test, type Page } from "@playwright/test";

// DAG L19 — landing hierarchy under PUBMAX_LANDING_FIND_MY_PINT.
// Default webServer leaves the flag off (shipped). Flag-on cases require
// PUBMAX_LANDING_FIND_MY_PINT=1 on the Playwright webServer (see playwright.config).

const FLAG_ON = process.env.PUBMAX_LANDING_FIND_MY_PINT === "1";

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
  test.skip(FLAG_ON, "this suite asserts the flag-off (shipped) hierarchy");

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

test.describe("landing Find my pint hierarchy (flag on)", () => {
  test.skip(!FLAG_ON, "run with PUBMAX_LANDING_FIND_MY_PINT=1");

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
});
