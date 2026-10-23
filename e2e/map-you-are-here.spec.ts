import { expect, test, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const MAP_FIRST_VISIT_KEY = "pubmax:map-first-visit-arrival:v1";

async function waitForPins(page: Page): Promise<void> {
  await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace?: unknown[];
              }
            ).__pubmaxPinRevealTrace?.length ?? 0,
        ),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
}

async function prepareMap(page: Page): Promise<void> {
  // The dot is an app-owned source, so the basemap need not be live, and live
  // tiles cost a headless browser seconds of main thread per painted frame.
  await installDeterministicMapBasemap(page);
  await page.addInitScript((arrivalKey) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.removeItem(arrivalKey);
    window.sessionStorage.setItem("pubmax:pin-reveal", "1");
    const revealWindow = window as typeof window & {
      __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
    };
    if (!revealWindow.__pubmaxPinRevealTrace) {
      const trace: Array<{ reason: string; generation: number }> = [];
      revealWindow.__pubmaxPinRevealTrace = trace;
      window.addEventListener("pubmax:pin-reveal", (event) => {
        trace.push(
          (event as CustomEvent<{ reason: string; generation: number }>).detail,
        );
      });
    }
  }, MAP_FIRST_VISIT_KEY);
}


type ReaderDotReading = {
  hasSource: boolean;
  hasAccuracyLayer: boolean;
  hasCoreLayer: boolean;
  written: [number, number] | null;
  rendered: [number, number] | null;
};

async function readReaderDot(page: Page): Promise<ReaderDotReading> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxMapReaderPosition?: { read: () => ReaderDotReading };
      }
    ).__pubmaxMapReaderPosition;
    if (!probe) throw new Error("reader position probe missing");
    return probe.read();
  }) as Promise<ReaderDotReading>;
}

type CameraReading = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  moving: boolean;
  settling: boolean;
};

async function readCamera(page: Page): Promise<CameraReading> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxMapCamera?: { read: () => CameraReading };
      }
    ).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe missing");
    return probe.read();
  }) as Promise<CameraReading>;
}

/**
 * The dot as the map holds it. `querySourceFeatures` decodes a rendered tile,
 * so the coordinates come back quantised to the tile grid - close, never
 * identical - and every comparison here is a distance rather than an equality.
 */
function metresApart(
  a: [number, number],
  b: [number, number],
): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111_320 * Math.cos(meanLat);
  const dy = (a[1] - b[1]) * 110_574;
  return Math.hypot(dx, dy);
}

test.describe("map you are here dot", () => {
  test("granted location paints a dot that moves without moving the camera", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["geolocation"]);
    const first = { latitude: 51.515, longitude: -0.09, accuracy: 25 };
    const second = { latitude: 51.5162, longitude: -0.0882, accuracy: 40 };
    await context.setGeolocation(first);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepareMap(page);

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    // A server-painted control is tappable before React attaches, so the tap
    // is retried rather than the assertion after it (e2e/AGENTS.md).
    const useMyLocation = arrival.getByRole("button", { name: "Use my location" });
    await expect(async () => {
      await useMyLocation.click();
      await expect(page.locator('[data-user-location="shown"]')).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });

    await expect
      .poll(async () => page.evaluate(() => "__pubmaxMapReaderPosition" in window), {
        timeout: 30_000,
      })
      .toBe(true);

    // The source and BOTH layers exist. A circle-radius MapLibre refuses is
    // dropped from the style in silence, so the ring's absence is the defect
    // this reading is here to catch; the dot alone still paints without it.
    await expect
      .poll(
        async () => {
          const dot = await readReaderDot(page);
          return [dot.hasSource, dot.hasAccuracyLayer, dot.hasCoreLayer];
        },
        { timeout: 30_000 },
      )
      .toEqual([true, true, true]);

    // The fix reached the canvas, and MapLibre is drawing it.
    await expect
      .poll(async () => (await readReaderDot(page)).written, { timeout: 30_000 })
      .toEqual([first.longitude, first.latitude]);
    await expect
      .poll(
        async () => {
          const { rendered } = await readReaderDot(page);
          if (!rendered) return Number.POSITIVE_INFINITY;
          return metresApart(rendered, [first.longitude, first.latitude]);
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(20);

    await expect
      .poll(async () => page.evaluate(() => "__pubmaxMapCamera" in window), {
        timeout: 30_000,
      })
      .toBe(true);
    // The opening-location answer owns a camera move of its own; let it settle
    // before the reading the dot's own move is held against. A move waiting for
    // its frame is not moving yet, so `settling` has to be clear as well.
    await expect
      .poll(
        async () => {
          const camera = await readCamera(page);
          return camera.moving || camera.settling;
        },
        { timeout: 30_000 },
      )
      .toBe(false);

    const cameraBefore = await readCamera(page);

    await context.setGeolocation(second);

    // The dot follows the fix. This is the assertion that fails if the watch
    // stops feeding the source, so nothing downstream may run before it.
    await expect
      .poll(async () => (await readReaderDot(page)).written, { timeout: 60_000 })
      .toEqual([second.longitude, second.latitude]);
    await expect
      .poll(
        async () => {
          const { rendered } = await readReaderDot(page);
          if (!rendered) return Number.POSITIVE_INFINITY;
          return metresApart(rendered, [second.longitude, second.latitude]);
        },
        { timeout: 30_000 },
      )
      .toBeLessThan(20);

    // ... and the camera does not. No flyTo, easeTo, jumpTo, fitBounds or
    // setCenter rides the reader's position: components/AGENTS.md.
    const cameraAfter = await readCamera(page);
    expect(metresApart(cameraAfter.center, cameraBefore.center)).toBeLessThan(5);
    expect(cameraAfter.zoom).toBeCloseTo(cameraBefore.zoom, 3);
    expect(cameraAfter.bearing).toBeCloseTo(cameraBefore.bearing, 3);
    expect(cameraAfter.pitch).toBeCloseTo(cameraBefore.pitch, 3);
  });
});
