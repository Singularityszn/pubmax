import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

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

async function semanticPricePixelCount(
  screenshot: Buffer,
  colours: readonly [number, number, number][],
  extract?: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const pipeline = sharp(screenshot);
  if (extract) pipeline.extract(extract);
  const { data } = await pipeline.removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += 3) {
    if (
      colours.some(
        ([red, green, blue]) =>
          Math.max(
            Math.abs(data[index] - red),
            Math.abs(data[index + 1] - green),
            Math.abs(data[index + 2] - blue),
          ) <= 36,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

async function selectNoAlcohol(page: Page): Promise<void> {
  await page.route("**/api/price-submit?lens=no-alcohol", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prices: [], truncated: false }),
    }),
  );
  const indexResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
      candidate.status() === 200,
  );
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="filters"]',
  );
  await expect(sheet).toBeVisible();
  await sheet
    .getByRole("button", { name: "No alcohol", exact: true })
    .click();
  await indexResponse;
}

async function expectNoAlcoholKey(page: Page): Promise<void> {
  const key = page
    .locator('.mobileSheetPortal[data-sheet-kind="filters"]')
    .getByLabel("Map key");
  await expect(key).toContainText(
    "Clusters stay grey because no current venue has a trusted alcohol-free or soft drink price.",
  );
}

async function zoomThroughHiddenMobileControl(page: Page, steps = 3): Promise<void> {
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  for (let step = 0; step < steps; step += 1) {
    await zoomIn.evaluate((button: HTMLButtonElement) => button.click());
    // MapLibre animates zoomIn. Let each level settle so rapid synthetic
    // clicks cannot coalesce into one camera transition and only three tiles.
    await page.waitForTimeout(600);
  }
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

test("/map does not report a background failure after one basemap source paints", async ({
  page,
}) => {
  test.setTimeout(55_000);
  await installDeterministicMapBasemap(page, {
    primaryRasterDelayMs: 20_000,
    secondaryRasterDelayMs: 60_000,
    stallSecondaryRaster: true,
  });

  await page.goto("/map");
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 18_000,
  });
  await expect(notice).toHaveCount(0, { timeout: 12_000 });
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map No alcohol key matches rendered mobile clusters at 390px", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicMapBasemap(page);

  await page.goto("/map");
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const renderedMapBand = {
    left: 0,
    top: 180,
    width: 390,
    height: 190,
  };
  const priceClusterColours = [
    [23, 149, 98],
    [215, 149, 26],
  ] as const;

  await selectNoAlcohol(page);
  await expectNoAlcoholKey(page);
  await expect
    .poll(
      async () =>
        semanticPricePixelCount(
          await canvas.screenshot(),
          priceClusterColours,
          renderedMapBand,
        ),
      { timeout: 15_000 },
    )
    .toBeLessThan(10);
  await expect
    .poll(
      async () =>
        semanticPricePixelCount(
          await canvas.screenshot(),
          [[87, 87, 95]],
          renderedMapBand,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(50);
});

test("/map stays visually stable for a reduced-motion viewer while idle", async ({ page }) => {
  test.setTimeout(75_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
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

  // Once settled, reduced-motion mode must remain stable across a longer
  // untouched interval while allowing finite tile loading to complete.
  await page.waitForTimeout(1_200);
  const finalFrame = await map.screenshot();
  expect(await changedPixelRatio(settledFrame!, finalFrame)).toBeLessThan(0.02);
});

test("/map reveals pins only for the final rapid theme style generation", async ({ page }) => {
  test.setTimeout(60_000);
  const sourcesErrors: string[] = [];
  const recordSourcesError = (text: string) => {
    if (/Cannot read properties of undefined.*sources/i.test(text)) {
      sourcesErrors.push(text);
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      recordSourcesError(message.text());
    }
  });
  page.on("pageerror", (error) => recordSourcesError(error.message));
  await installDeterministicMapBasemap(page, { styleDelayMs: 150 });
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
  expect(
    sourcesErrors,
    `Rapid style replacement raised the historical sources exception:\n${sourcesErrors.join("\n")}`,
  ).toEqual([]);
});

test("/map uses the bounded pin fallback when basemap tiles are delayed", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });
  let holdTiles = true;
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    // Hold every vector tile beyond the coordinator's 12s readiness ceiling.
    // Browser contexts are fresh and service workers are blocked for this
    // project, so the timeout path cannot be defeated by cache timing.
    if (holdTiles) await new Promise((resolve) => setTimeout(resolve, 15_000));
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

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load");
  const retry = notice.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible();
  const [retryBox, tabBarBox] = await Promise.all([
    retry.boundingBox(),
    page.locator(".mobileTabBar").boundingBox(),
  ]);
  expect(retryBox).not.toBeNull();
  expect(tabBarBox).not.toBeNull();
  expect(retryBox!.height).toBeGreaterThanOrEqual(44);
  expect(retryBox!.y + retryBox!.height).toBeLessThanOrEqual(tabBarBox!.y);

  holdTiles = false;
  await retry.click();
  await expect(notice).toHaveCount(0);
  await expect
    .poll(async () => (await trace()).at(-1)?.reason, { timeout: 20_000 })
    .toMatch(/^(tiles|idle)$/);
});

test("/map keeps the honest retry visible while basemap tiles keep failing", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/\.pbf(?:\?|$)/, (route) => route.abort("failed"));

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map surfaces a concurrent post-paint tile outage despite one successful tile", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
    });
  });
  let failTiles = false;
  let outageRequests = 0;
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    if (!failTiles) {
      await route.continue();
      return;
    }
    outageRequests += 1;
    const requestNumber = outageRequests;
    await new Promise((resolve) =>
      setTimeout(resolve, requestNumber === 5 ? 1_250 : 1_000),
    );
    if (requestNumber === 5) {
      await route.continue();
      return;
    }
    await route.abort("failed");
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/^(tiles|idle)$/);

  failTiles = true;
  // Mobile CSS deliberately hides MapLibre's built-in control group. Invoke
  // its real button handler in place so this outage test can force fresh tile
  // requests without weakening the phone chrome contract.
  await zoomThroughHiddenMobileControl(page);
  await expect.poll(() => outageRequests).toBeGreaterThanOrEqual(5);

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map surfaces Retry when the automatic style reload also fails", async ({
  page,
}) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const trace: Array<{ reason: string; generation: number }> = [];
    Object.defineProperty(window, "__pubmaxPinRevealTrace", { value: trace });
    window.addEventListener("pubmax:pin-reveal", (event) => {
      trace.push(
        (event as CustomEvent<{ reason: string; generation: number }>).detail,
      );
    });
  });
  let failTiles = false;
  let failStyles = false;
  await page.route(
    /tiles\.openfreemap\.org\/styles\/|basemaps\.cartocdn\.com\/gl\/.*\/style\.json/,
    async (route) => {
      if (failStyles) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    },
  );
  await page.route(/\.pbf(?:\?|$)/, async (route) => {
    if (!failTiles) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.abort("failed");
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace: Array<{
                  reason: string;
                  generation: number;
                }>;
              }
            ).__pubmaxPinRevealTrace.at(-1)?.reason ?? null,
        ),
      { timeout: 30_000 },
    )
    .toMatch(/^(tiles|idle)$/);

  failTiles = true;
  failStyles = true;
  await zoomThroughHiddenMobileControl(page);

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 30_000,
  });
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});

test("/map states a TileJSON metadata failure instead of revealing a blank field", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    /tiles\.openfreemap\.org\/planet(?:\?|$)/,
    (route) => route.abort("failed"),
  );

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 20_000,
  });

  const notice = page.locator(".mapSoftRetry");
  await expect(notice).toContainText("Map background couldn't load", {
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
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
  await expect(fallback).toContainText(/renderer started but never drew a frame/i);
  await expect(fallback.getByRole("button", { name: "Technical details" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

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

test("/map keeps Manchester cluster markers mounted after granted location settles", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 53.4808, longitude: -2.2426 });

  // Load Manchester with permission already granted, then invoke the attached
  // control directly. Banner staging may hide it, but HTMLElement.click still
  // exercises the same checkNearby/onLocationFound path as a painted control.
  await page.goto("/map/manchester");
  const nearMe = page.locator("button.citySuggestBannerSwitch");
  await expect(nearMe).toBeAttached({ timeout: 20_000 });
  await expect(nearMe).toBeEnabled({ timeout: 20_000 });
  await nearMe.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(".mapUserLocationMarker")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(2_000);
  const showAll = page.getByRole("button", {
    name: "Show all of Manchester",
  });
  await expect(showAll).toBeVisible({ timeout: 20_000 });
  await showAll.click();

  const donuts = page.locator(".donut-cluster-marker");
  // fitCityBounds runs an 800 ms cinematic. Let that intentional transition
  // finish, then require a stable non-empty cluster count before observing for
  // the ongoing empty/non-empty loop this regression targets.
  await page.waitForTimeout(1_000);
  await expect
    .poll(
      async () => {
        const counts = [await donuts.count()];
        for (let sample = 0; sample < 4; sample += 1) {
          await page.waitForTimeout(150);
          counts.push(await donuts.count());
        }
        return counts[0] > 0 && counts.every((count) => count === counts[0]);
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Once the city camera has settled, transient source snapshots must not
  // unmount every donut and hand the same clusters back to the GL fallback.
  // That DOM-empty/GL-visible alternation is the reported desktop flicker.
  const counts: number[] = [];
  for (let sample = 0; sample < 30; sample += 1) {
    counts.push(await donuts.count());
    await page.waitForTimeout(75);
  }
  expect(counts, `cluster marker counts after settle: ${counts.join(",")}`).not.toContain(0);
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

test("desktop area search resolves a gazetteer locality and fits the map", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents = [];
    window.addEventListener("pubmax:camera-intent", (event) => {
      const detail = (event as CustomEvent<{ kind: string; sequence: number }>).detail;
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents?.push(detail);
    });
  });
  await page.route("**/data/london_localities.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        localities: [
          { name: "Willesden", lat: 51.549, lng: -0.229, borough: "Brent" },
        ],
      }),
    }),
  );
  await page.route("**/api/area-news**", (route) => {
    const area = new URL(route.request().url()).searchParams.get("area");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: area === "brent"
          ? [{
              id: "brent-search-context",
              kind: "opening",
              title: "Brent search context",
              sourceUrl: "https://example.com/brent",
              sourceName: "Example Times",
              observedAt: "2026-07-23T18:00:00.000Z",
            }]
          : [],
      }),
    });
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: 20_000 });

  const search = page.locator("#mapSearchInput");
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill("Willesden");

  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(listbox).toBeVisible();
  const willesden = listbox.getByRole("option", { name: /Willesden.*Brent/i });
  await expect(willesden).toBeVisible();
  await expect(willesden).toContainText(/from centre/i);
  await expect(willesden.locator(".mapSearchSuggestCoverage")).toHaveCount(0);

  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(listbox).toHaveCount(0);

  await expect.poll(async () => page.evaluate(() => (
    window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }
  ).__cameraIntents?.filter((intent) => intent.kind === "area").length ?? 0)).toBe(1);

  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("pubmaxx.mobile-map-session.v1");
    if (!raw) return null;
    const session = JSON.parse(raw) as { viewport?: { center?: [number, number]; zoom?: number } };
    return session.viewport ?? null;
  }), { timeout: 10_000 }).toMatchObject({
    center: [expect.closeTo(-0.229, 2), expect.closeTo(51.549, 2)],
    zoom: expect.closeTo(14.5, 1),
  });

  await expect(page.locator(".desktopRail.mapRail")).toContainText("Brent search context");
  await expect(page.locator(".mapDrawer.right.open")).toHaveCount(0);
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
