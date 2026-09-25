import { expect, test } from "@playwright/test";

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test.describe(`map live QA fixes ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("/map/list opens the venue list on the map", async ({ page }) => {
      const response = await page.goto("/map/list");
      expect(response).not.toBeNull();
      const arrived = new URL(response!.url());
      expect(arrived.pathname).toBe("/map");
      expect(arrived.searchParams.get("list")).toBe("1");
      expect(response!.request().redirectedFrom()?.url()).toMatch(/\/map\/list$/);
      await expect(page.getByRole("button", { name: /Hide venue list|List view/i })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('[id^="map-venue-list-item-"]').first()).toBeVisible({
        timeout: 30_000,
      });
    });

    test("cold /map opens on London, not the whole UK", async ({ page, context }) => {
      await context.clearCookies();
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
        window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      });
      await page.goto("/map");
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(async () => page.evaluate(() => "__pubmaxMapCamera" in window), {
          timeout: 45_000,
        })
        .toBe(true);
      const camera = await page.evaluate(() => {
        const probe = (
          window as Window & {
            __pubmaxMapCamera?: { read: () => { zoom: number; center: [number, number] } };
          }
        ).__pubmaxMapCamera;
        return probe?.read() ?? null;
      });
      expect(camera).not.toBeNull();
      const [lng, lat] = camera!.center;
      expect(lat).toBeGreaterThan(51);
      expect(lat).toBeLessThan(52);
      expect(lng).toBeGreaterThan(-0.5);
      expect(lng).toBeLessThan(0.2);
      expect(camera!.zoom).toBeGreaterThan(10);
    });
  });
}
