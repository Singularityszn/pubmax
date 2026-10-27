import { expect, test } from "@playwright/test";

import { stubSocialAuthProviders } from "./helpers/authDoubles";

test.use({ serviceWorkers: "block" });

for (const viewport of [
  { width: 390, height: 844, navigation: "Primary" },
  { width: 1440, height: 900, navigation: "Site navigation" },
]) {
  test(`one Plan click shows feedback while the route waits at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date("2026-10-27T12:00:00Z"));
    await stubSocialAuthProviders(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto("/u/you");

    const nav = page.getByRole("navigation", { name: viewport.navigation, exact: true });
    // The live day href confirms that this navigation hydrated before the single click.
    await expect(nav.locator('a[href="/today"]')).toBeVisible();
    const plan = nav.getByRole("link", { name: "Plan", exact: true });
    await expect(plan).toBeVisible();
    const initialBox = await plan.boundingBox();
    const initialHistoryLength = await page.evaluate(() => history.length);
    let releaseRoute!: () => void;
    const routeHeld = new Promise<void>((resolve) => { releaseRoute = resolve; });
    let sawRoute!: () => void;
    const routeRequested = new Promise<void>((resolve) => { sawRoute = resolve; });
    await page.route((url) => url.pathname === "/plan", async (route) => {
      if (route.request().headers().rsc !== "1") {
        await route.fallback();
        return;
      }
      sawRoute();
      await routeHeld;
      await route.continue();
    });

    try {
      await plan.click();
      await routeRequested;
      const feedback = plan.getByRole("progressbar", { name: "Opening page" });
      await expect(feedback).toBeVisible({ timeout: 1_000 });
      await expect(plan).toHaveAccessibleName("Plan");
      await expect(page).toHaveURL(/\/u\/you$/);
      await expect.poll(() => plan.boundingBox()).toEqual(initialBox);
    } finally {
      releaseRoute();
    }

    await expect(page).toHaveURL(/\/plan$/);
    await expect(nav.getByRole("progressbar", { name: "Opening page" })).toHaveCount(0);
    await expect(plan).toHaveAccessibleName("Plan");
    expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);
  });
}
