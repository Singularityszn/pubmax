import { test, expect } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [390, 768, 1440]) {
  test(`UK overview releases loading before city data at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const nationalDataRequests: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/data/uk_base/") && !path.endsWith("places.json")) {
        nationalDataRequests.push(path);
      }
    });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?uk=1");
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 30_000 });
    const wrap = page.locator(".mapCanvasWrap");
    await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required");
    await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".mapFallback")).toHaveCount(0);
    await expect(page.getByText("Still loading pubs…", { exact: true })).toHaveCount(0);
    expect(nationalDataRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`uk-overview-${width}.png`) });
  });
}
