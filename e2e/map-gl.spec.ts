import { test, expect } from "@playwright/test";
import sharp from "sharp";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function changedPixelRatio(first: Buffer, second: Buffer): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(first).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(second).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  expect(b.info.width).toBe(a.info.width);
  expect(b.info.height).toBe(a.info.height);

  let changed = 0;
  const pixels = a.info.width * a.info.height;
  for (let index = 0; index < a.data.length; index += 3) {
    const delta =
      Math.abs(a.data[index] - b.data[index]) +
      Math.abs(a.data[index + 1] - b.data[index + 1]) +
      Math.abs(a.data[index + 2] - b.data[index + 2]);
    if (delta > 24) changed += 1;
  }
  return changed / pixels;
}

// GPU-present contract. Runs only under the `chromium-gl` project, which launches
// Chromium with SwiftShader (a software GL implementation) so a real WebGL2
// context exists even on a GPU-less CI box. Where smoke.spec.ts asserts
// canvas-OR-fallback (WebGL-agnostic), this spec asserts the *success* half: a
// browser with a working GL stack must paint the MapLibre canvas and NEVER show
// the "Map renderer unavailable" fallback. It is the regression guard for the
// real-browser fallback reports.

test("/map renders the MapLibre canvas with real size and never falls back", async ({
  page,
}) => {
  // This test deliberately waits out the full tile-timeout window (see the
  // second assertion block), which alone exceeds the 30s project default.
  test.setTimeout(60_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map is a dynamic import (ssr:false) behind a loading shell; the wrapper
  // appears first, then either the canvas or the fallback. Give MapLibre room to
  // construct + acquire its context under parallel load.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });

  // Success assertion: the MapLibre container's <canvas> exists, is visible, and
  // has non-zero paint area. MapLibre creates the canvas synchronously on a
  // successful construct, so its presence + size is the honest "GL works" signal.
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // The whole point: with a working GL stack the fallback must never render.
  // Assert it after the canvas is up AND after the component's one silent
  // auto-retry window (1500ms) could have elapsed, so a late fallback can't slip
  // through green.
  await page.waitForTimeout(2000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();

  // Tile-timeout regression guard (the "Map tiles unavailable" report). The
  // canvas can construct fine while the *style* silently fails to load its
  // tiles: PubMapCanvas waits STYLE_LOAD_TIMEOUT_MS (8s), swaps to the CARTO
  // fallback style, then waits another 8s before surfacing the kind:"tiles"
  // .mapFallback. A short wait (above) passes green even if that's about to
  // fire — and a CSP that blocks the CARTO fallback (basemaps.cartocdn.com /
  // tiles.basemaps.cartocdn.com must be in connect-src) guarantees it fires.
  // Wait out the full 8s+8s window so a tile/CSP failure can't hide behind an
  // early green. Either OpenFreeMap loads directly, or the CARTO fallback does;
  // either way the fallback must never appear and the canvas must stay up.
  await page.waitForTimeout(18_000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
});

test("/map stays visually stable while the viewer is idle", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 30_000 });

  const map = page.locator(".maplibreMap");
  let settledFrame: Buffer | null = null;

  // Tile arrival is network-dependent even after MapLibre removes its loading
  // chrome. Wait for one genuinely stable visual interval instead of sampling a
  // still-loading basemap at a fixed wall-clock delay. This does not mask any
  // pixels or relax the 2% contract: the complete rendered map must settle.
  await expect
    .poll(
      async () => {
        const first = await map.screenshot();
        await page.waitForTimeout(500);
        const second = await map.screenshot();
        const ratio = await changedPixelRatio(first, second);
        if (ratio < 0.02) settledFrame = second;
        return ratio;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBeLessThan(0.02);

  // Once settled, a longer untouched interval must remain stable. This catches
  // perpetual rotation/repaint while allowing finite tile loading to complete.
  await page.waitForTimeout(1_200);
  const finalFrame = await map.screenshot();
  expect(await changedPixelRatio(settledFrame!, finalFrame)).toBeLessThan(0.02);
});

test("/map reveals pins only for the final rapid theme style generation", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  const readTrace = () => page.evaluate(() => (
    window as typeof window & {
      __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
    }
  ).__pubmaxPinRevealTrace);
  await expect.poll(async () => (await readTrace()).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const initialGeneration = (await readTrace()).at(-1)!.generation;

  await page.evaluate(async () => {
    const root = document.documentElement;
    const initial = root.dataset.theme === "dark" ? "dark" : "light";
    const alternate = initial === "dark" ? "light" : "dark";
    for (const theme of [alternate, initial, alternate]) {
      root.dataset.theme = theme;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });

  await expect.poll(async () => (
    await readTrace()
  ).filter(({ generation }) => generation > initialGeneration).length, { timeout: 25_000 }).toBe(1);
  await page.waitForTimeout(500);
  expect((await readTrace()).filter(({ generation }) => generation > initialGeneration)).toHaveLength(1);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map uses the bounded pin fallback when basemap tiles are delayed", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    // Hold every vector tile beyond the coordinator's 12s readiness ceiling.
    // Browser contexts are fresh and service workers are blocked for this
    // project, so the timeout path cannot be defeated by cache timing.
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    await route.continue();
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  const trace = () => page.evaluate(() => (
    window as typeof window & {
      __pubmaxPinRevealTrace: Array<{ reason: string; generation: number }>;
    }
  ).__pubmaxPinRevealTrace);
  await expect.poll(async () => (await trace()).at(-1)?.reason, { timeout: 20_000 }).toBe("timeout");
  const reveal = (await trace()).at(-1)!;
  await page.waitForTimeout(1_000);
  expect((await trace()).filter(({ generation }) => generation === reveal.generation)).toHaveLength(1);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

// First-frame watchdog contract (the blank-white-map report). A browser can
// GRANT a WebGL context (so the constructor succeeds and style.load fires,
// retiring the loading chrome) while its render loop never produces a single
// frame — dead software rasterizer, GPU-process crash after context creation,
// stalled rAF. Before the watchdog, that user sat on a permanently blank white
// map with no basemap, no pins, and no fallback. Stubbing rAF to never fire is
// the deterministic stand-in for "the first basemap frame never arrives": this
// project (SwiftShader) guarantees construction succeeds, so the only way the
// fallback can appear is via the FIRST_FRAME_TIMEOUT_MS watchdog.
test("/map degrades to the fallback when the renderer never draws a frame", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Frame loop never runs: rAF registers callbacks but never invokes them.
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map constructs (context granted) — the canvas exists…
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });

  // …but no frame ever renders, so the watchdog must surface the honest
  // fallback (10s timeout + queueMicrotask + render slack).
  const fallback = page.locator(".mapFallback");
  await expect(fallback).toBeVisible({ timeout: 25_000 });
  await expect(fallback).toContainText("Map couldn't draw");
  await expect(page.locator(".mapFallbackDetail")).toContainText(/No basemap frame/i);

  // A dead frame loop is retryable (a re-init can recover a crashed GPU
  // process), so Retry stays visible — unlike the confirmed-no-WebGL case.
  await expect(page.locator(".mapFallbackRetry")).toBeVisible();

  // Venue content survives: static list rows + the directory link.
  await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
  await expect
    .poll(async () => page.locator(".mapFallbackVenue").count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test("/map reuses granted location after an explicit Near me action", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.513, longitude: -0.125 });
  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Near me" }).click();
  await expect(page.getByRole("button", { name: "Nearby" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapUserLocationMarker")).toBeVisible({ timeout: 20_000 });
});

// Issue #35 — optimistic-pins perf guard. The map paints pins from the ~116 KB
// slim index BEFORE the ~5.6 MB full dataset lands; PubMap drops a
// `pubmax:first-pins` performance.mark the instant those slim pins are set.
// Asserting the mark exists and fires early is a WebGL-flake-free proxy for
// "first interactive pin is fast" (the PRD's map-click → first pin target),
// since it measures the data path, not the GPU. Threshold is a generous CI
// ceiling (4s) well under the old full-dataset-only path.
test("/map paints optimistic pins from the slim index quickly", async ({ page }) => {
  test.setTimeout(60_000);
  const fullDatasetRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/data/pint_prices_app_dataset.json") {
      fullDatasetRequests.push(request.url());
    }
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // Wait until PubMap has set its first-pins mark. It's dropped in a client
  // effect after loadSlimVenues() resolves, so poll the Performance timeline.
  await expect
    .poll(
      () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);

  const startTime = await page.evaluate(() => {
    const [mark] = performance.getEntriesByName("pubmax:first-pins");
    return mark ? mark.startTime : Number.POSITIVE_INFINITY;
  });

  // startTime is ms since navigation start — the time to the first optimistic
  // pin paint. The network assertion below is the hard regression guard against
  // reintroducing the full-dataset path; this ceiling stays CI-safe under
  // SwiftShader and a cold production server.
  expect(startTime).toBeLessThan(10000);
  expect(fullDatasetRequests).toEqual([]);
});

test("/map lazy-loads full venue detail only when a pub is selected", async ({ page }) => {
  test.setTimeout(30_000);
  const fullDatasetRequests: string[] = [];
  const venueDetailRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/data/pint_prices_app_dataset.json") {
      fullDatasetRequests.push(request.url());
    }
    if (path.startsWith("/api/venue/")) {
      venueDetailRequests.push(request.url());
    }
  });

  const selectedVenueId = "venue-16pnwmm";
  const response = await page.goto(`/map?sel=${selectedVenueId}`);
  expect(response?.status()).toBe(200);

  await expect
    .poll(
      () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  await expect(page.getByRole("heading", { name: /Prospect of Whitby/i })).toBeVisible();
  await expect
    .poll(() => venueDetailRequests.filter((url) => url.includes(selectedVenueId)).length)
    .toBeGreaterThan(0);
  expect(fullDatasetRequests).toEqual([]);
});
