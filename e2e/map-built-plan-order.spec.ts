import { expect, test } from "@playwright/test";
import { desktopPlannerDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

for (const hasStop of [true, false]) {
  test(`desktop ${hasStop ? "built route" : "empty build"} opens in the correct order`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
    const response = await page.goto(`/map?mode=build${hasStop ? "&pubs=venue-149rmv7" : ""}`);
    expect(response?.status()).toBe(200);
    const drawer = desktopPlannerDrawer(page);
    const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
      await expect(drawer).toHaveClass(/\bopen\b/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    const route = drawer.locator(".routePanel");
    const controls = drawer.locator(".controlRail");
    await expect(route).toBeVisible();
    await expect(controls).toBeVisible();
    const routeBox = await route.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect(routeBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(routeBox!.y < controlsBox!.y).toBe(hasStop);
    if (hasStop) {
      const stop = route.getByRole("button", { name: /^1 Duke of York/ });
      await expect(stop).toBeVisible();
      const stopBox = await stop.boundingBox();
      expect(stopBox).not.toBeNull();
      expect(stopBox!.x).toBeGreaterThanOrEqual(0);
      expect(stopBox!.x + stopBox!.width).toBeLessThanOrEqual(1440);
      expect(stopBox!.y).toBeGreaterThanOrEqual(0);
      expect(stopBox!.y + stopBox!.height).toBeLessThanOrEqual(900);
    }
    await testInfo.attach("planner-first-screen", { body: await page.screenshot(), contentType: "image/png" });
  });
}
