import { expect, test } from "@playwright/test";
import { UI_UX_CHROMIUM_ARGS } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use({ serviceWorkers: "block", launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] } });

// A real short Soho walk reproduced with the saved-plan map link.
const STOP_IDS = ["venue-7tarkc", "venue-122cuu1", "venue-s2ppfm"];

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`a short walking route fills useful map space at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let releaseStatus = () => {};
    const statusReady = width === 1280
      ? new Promise<void>((resolve) => { releaseStatus = resolve; })
      : Promise.resolve();
    page.on("close", () => releaseStatus());
    await page.route("**/api/citymcp/status**", async (route) => {
      await statusReady;
      await route.fulfill({ json: {
        asOf: new Date().toISOString(), weather: null, signals: [],
        tubeLines: [
          { line: "Central", status: "Minor Delays" },
          { line: "District", status: "Severe Delays" },
          { line: "Suffragette", status: "Minor Delays" },
        ],
      } });
    });
    const coordinates = await Promise.all(STOP_IDS.map(async (id) => {
      const response = await request.get(`/api/venue/${id}`);
      expect(response.ok()).toBe(true);
      const { venue } = await response.json();
      return [venue.longitude, venue.latitude] as [number, number];
    }));
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "dark");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax-tour-v2-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    });
    await page.goto(`/map?mode=build&pubs=${STOP_IDS.join(",")}`);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "3", { timeout: 60_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect.poll(() => page.evaluate((stops) => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera?: {
          read(): { moving: boolean; settling: boolean };
          project(point: [number, number]): { x: number; y: number };
        };
      }).__pubmaxMapCamera;
      if (!probe || probe.read().moving || probe.read().settling) return false;
      const points = stops.map(point => probe.project(point));
      const span = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
      // At zoom 15 this walk occupied about 60px on a desktop and its discs
      // overlapped. It must be readable, yet keep every stop below the chrome.
      return span >= Math.min(160, innerWidth * 0.4)
        && points.every(point => point.x >= 20 && point.x <= innerWidth - 20
          && point.y >= 170 && point.y <= innerHeight - 180);
    }, coordinates), { timeout: 60_000 }).toBe(true);
    releaseStatus();
    if (width === 1280) await expect(page.locator(".cityStatusBanner")).toBeVisible();
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
    const uncoveredStops = await page.evaluate((stops) => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } };
      }).__pubmaxMapCamera;
      return stops.map((stop) => {
        const point = probe!.project(stop);
        return Boolean(document.elementFromPoint(point.x, point.y)?.closest(".maplibregl-canvas"));
      });
    }, coordinates);
    expect(uncoveredStops).toEqual([true, true, true]);
    await page.screenshot({ path: testInfo.outputPath(`short-walk-${width}.png`) });
  });
}
