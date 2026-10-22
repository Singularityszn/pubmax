import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { UI_UX_CHROMIUM_ARGS } from "../../../scripts/lib/uiUxBattleTestBrowser.mjs";

const origin = process.argv[2];
assert(origin, "Pass this branch's private production origin");
const browser = await chromium.launch({ headless: true, args: UI_UX_CHROMIUM_ARGS });
const deadline = setTimeout(() => void browser.close(), 360_000);
const output = [];
try {
  for (const permission of ["denied", "granted"]) {
    for (let pair = 1; pair <= 3; pair += 1) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, reducedMotion: "reduce",
        geolocation: { latitude: 51.515, longitude: -0.09, accuracy: 25 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      await cdp.send("Browser.setPermission", {
        browserContextId: targetInfo.browserContextId, origin,
        permission: { name: "geolocation" }, setting: permission,
      });
      await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax:first-pins-seen:v1", "1");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmax:map-chosen-area:v1", JSON.stringify({
          cityId: "london", kind: "near-me", label: "Near me", slug: "near-me",
        }));
        localStorage.setItem("map-resume:v1:london", JSON.stringify({
          version: 1, cityId: "london", savedAt: Date.now() - 6 * 86_400_000,
          viewport: { center: [-0.21, 51.54], zoom: 14, pitch: 0, bearing: 0 }, rows: [],
        }));
        const observe = () => {
          if (window.__pubmaxPaintedMapTapPoints?.().length) {
            window.__cacheProofFirstTap = performance.now();
          } else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      });
      for (const visit of ["cold", "warm"]) {
        assert.equal((await page.goto(`${origin}/map`))?.status(), 200);
        await page.waitForFunction(() => window.__cacheProofFirstTap > 0, null, { timeout: 45_000 });
        if (permission === "granted") {
          await page.waitForFunction(() => {
            const camera = window.__pubmaxMapCamera?.read();
            return camera && Math.abs(camera.center[0] + 0.09) < 0.04 &&
              Math.abs(camera.center[1] - 51.515) < 0.025;
          }, null, { timeout: 20_000 });
        }
        await page.waitForFunction(() => {
          const camera = window.__pubmaxMapCamera?.read();
          return camera && !camera.moving;
        }, null, { timeout: 20_000 });
        await page.waitForTimeout(2_000);
        const reading = await page.evaluate(async () => ({
          permission: (await navigator.permissions.query({ name: "geolocation" })).state,
          firstObservedTappableMs: window.__cacheProofFirstTap,
          camera: window.__pubmaxMapCamera.read(),
          marks: performance.getEntriesByType("mark")
            .filter(({ name }) => name.startsWith("pubmax:"))
            .map(({ name, startTime }) => ({ name, startTime })),
          dataResources: performance.getEntriesByType("resource")
            .filter(({ name }) => new URL(name).pathname.startsWith("/data/"))
            .map(({ name, transferSize, encodedBodySize, duration }) => ({
              path: new URL(name).pathname, transferSize, encodedBodySize, duration,
            })),
        }));
        assert.equal(reading.permission, permission);
        assert.deepEqual(errors, []);
        if (permission === "granted") {
          assert(Math.abs(reading.camera.center[0] + 0.09) < 0.04);
        } else assert(Math.abs(reading.camera.center[0] + 0.21) < 0.00001);
        output.push({ permission, pair, visit, ...reading });
        writeFileSync("docs/proof/maps-audit-20260929/cache-browser.json", JSON.stringify({
          origin, viewport: "390x844", cpuThrottle: 1, networkThrottle: "none",
          conditions: "New isolated context per pair; same context reload for warm visit. Local storage resets each visit; HTTP, service worker and IndexedDB remain within pair. Unthrottled local server with remote basemap requests. No source cache change compared.",
          output,
        }, null, 2) + "\n");
        console.log(`${permission} pair ${pair} ${visit}: ${reading.firstObservedTappableMs.toFixed(1)}ms`);
      }
      await context.close();
    }
  }
} finally {
  clearTimeout(deadline);
  await browser.close();
}
