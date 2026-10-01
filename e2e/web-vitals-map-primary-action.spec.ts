import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { exercisePrimaryAction } from "./helpers/webVitals";

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`Web Vitals map action opens visible controls at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    await installDeterministicMapBasemap(page);
    await page.goto("/map", { waitUntil: "load" });
    await expect(page.locator(".mapStage")).toBeVisible();
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const trigger = viewport.width === 390
      ? page.getByRole("button", { name: "More map controls", exact: true })
      : page.locator(".mapLayersControl > .mapLayersFab").first();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const drawer = viewport.width === 390
      ? page.locator('.mobileSheetPortal[data-sheet-kind="layers"]')
      : page.getByRole("dialog", { name: "Map layers", exact: true });
    await expect(drawer).toBeHidden();
    await testInfo.attach("before-map-action", {
      body: await page.screenshot(), contentType: "image/png",
    });

    const interacted = await exercisePrimaryAction(page, "/map");
    await testInfo.attach("map-action-result", {
      body: JSON.stringify({ viewport, interacted, drawerVisible: await drawer.isVisible() }),
      contentType: "application/json",
    });
    await testInfo.attach("after-map-action", {
      body: await page.screenshot(), contentType: "image/png",
    });
    expect(interacted, "Measurement must exercise the route's visible map control").toBe(true);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeVisible();
  });
}
