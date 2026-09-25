import { expect, test, type Page } from "@playwright/test";

import { getCity } from "@/lib/cities";
import {
  MAP_ARRIVAL_BEARING_DEG,
  MAP_ARRIVAL_BEARING_EPSILON,
  MAP_ARRIVAL_BEARING_SETTLED_BY_MS,
} from "@/lib/mapArrivalBearing";

// The map's opening turn, against a real MapLibre camera (this spec runs in the
// `chromium-gl` project).
//
// Captain, 7 Sep 2026: "I also want the map to rotate slightly." A unit test
// owns the plan; only a real canvas can say where the camera came to rest, and
// that it then stopped. The deleted idle orbit is the reason the stillness
// sample is here: a turn that never ends is the defect this must not be.

const PHONE = { width: 390, height: 844 };

/** Generous: this suite paints through a software rasteriser on a shared box. */
const ARRIVAL_TIMEOUT_MS = 90_000;

/** How long the camera is watched for a turn nobody asked for. */
const STILLNESS_WINDOW_MS = 3_000;
const STILLNESS_SAMPLES = 6;

/** Floating-point slack on one eased bearing. */
const BEARING_TOLERANCE = 0.25;

/**
 * London's own designed attitude, which the canvas holds from the first frame,
 * while the opening location question is open and after it answers.
 *
 * The captain's ask is that the map not read as a flat diagram. A flat map
 * turns and a designed attitude is kept, so the guarantee test below accepts
 * either and the deterministic test above pins the turn itself.
 */
const LONDON_BEARING = getCity("london").mapView.bearing;

type CameraReading = {
  bearing: number;
  pitch: number;
  zoom: number;
  center: [number, number];
  moving: boolean;
};

async function readCamera(page: Page): Promise<CameraReading> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxMapCamera?: { read: () => CameraReading };
    }).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe absent");
    return probe.read();
  }) as Promise<CameraReading>;
}

async function openMap(page: Page, path = "/map"): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: ARRIVAL_TIMEOUT_MS,
  });
  await expect
    .poll(async () => page.evaluate(() => "__pubmaxMapCamera" in window), {
      timeout: ARRIVAL_TIMEOUT_MS,
    })
    .toBe(true);
}

/**
 * Wait out the whole opening window, then wait for the camera to stop.
 *
 * The turn does not start when the map is ready. It waits for the other camera
 * writers to finish, and that wait is stillness the spec must not mistake for
 * the end (lib/mapArrivalBearing.ts owns the window; this reads it rather than
 * keeping a second copy). Sleeping for the eased second alone read a flat map
 * on a build that turns to four degrees in 3.9 seconds, measured on the phone
 * rig.
 */
async function settleAfterArrival(page: Page): Promise<void> {
  await page.waitForTimeout(MAP_ARRIVAL_BEARING_SETTLED_BY_MS + 2_000);
  await expect
    .poll(async () => (await readCamera(page)).moving, { timeout: ARRIVAL_TIMEOUT_MS })
    .toBe(false);
}

test.use({ hasTouch: true, viewport: PHONE });

test.describe("the map's opening turn", () => {
  test("comes to rest off north, at one of the two attitudes the rule allows", async ({ page }) => {
    await openMap(page);
    await settleAfterArrival(page);

    const rested = await readCamera(page);
    // The promise, first: the map does not read as a flat diagram.
    expect(
      Math.abs(rested.bearing),
      `rested at ${rested.bearing}, expected the map to be off north`,
    ).toBeGreaterThan(MAP_ARRIVAL_BEARING_EPSILON);
    // Then WHICH off north, because "not zero" would pass on a map spinning to
    // any angle at all. Only two are allowed, and a third is a defect.
    const restsAtTurn =
      Math.abs(rested.bearing - MAP_ARRIVAL_BEARING_DEG) <= BEARING_TOLERANCE;
    const restsAtCityAttitude =
      Math.abs(rested.bearing - LONDON_BEARING) <= BEARING_TOLERANCE;
    expect(
      restsAtTurn || restsAtCityAttitude,
      `rested at ${rested.bearing}, expected ${MAP_ARRIVAL_BEARING_DEG} or ${LONDON_BEARING}`,
    ).toBe(true);

    // And it is one move, not a slow orbit: every later sample is that bearing.
    const samples: number[] = [];
    for (let index = 0; index < STILLNESS_SAMPLES; index += 1) {
      await page.waitForTimeout(STILLNESS_WINDOW_MS / STILLNESS_SAMPLES);
      samples.push((await readCamera(page)).bearing);
    }
    for (const bearing of samples) {
      expect(Math.abs(bearing - rested.bearing)).toBeLessThanOrEqual(BEARING_TOLERANCE);
    }
  });

  test("makes no turn at all for a reader who asks for no motion", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: PHONE,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await openMap(page);
    await settleAfterArrival(page);
    // No turn means the map is left exactly where it arrived, which is flat
    // north or the city's own attitude, and never the turned bearing.
    const rested = await readCamera(page);
    expect(
      Math.abs(rested.bearing) <= BEARING_TOLERANCE ||
        Math.abs(rested.bearing - LONDON_BEARING) <= BEARING_TOLERANCE,
      `rested at ${rested.bearing}, expected 0 or ${LONDON_BEARING}`,
    ).toBe(true);
    expect(
      Math.abs(rested.bearing - MAP_ARRIVAL_BEARING_DEG),
      `rested at ${rested.bearing}, which is the turn a reduced-motion reader refused`,
    ).toBeGreaterThan(BEARING_TOLERANCE);
    await context.close();
  });
});
