import { expect, test, type Page } from "@playwright/test";

import {
  MAP_ARRIVAL_BEARING_DEG,
  MAP_ARRIVAL_BEARING_DURATION_MS,
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

/** Wait until the eased turn has had its second, plus room for a slow box. */
async function settleAfterArrival(page: Page): Promise<void> {
  await page.waitForTimeout(MAP_ARRIVAL_BEARING_DURATION_MS + 2_000);
  await expect
    .poll(async () => (await readCamera(page)).moving, { timeout: ARRIVAL_TIMEOUT_MS })
    .toBe(false);
}

test.use({ hasTouch: true, viewport: PHONE });

test.describe("the map's opening turn", () => {
  test("comes to rest a few degrees off north, and then holds", async ({ page }) => {
    await openMap(page);
    await settleAfterArrival(page);

    const rested = await readCamera(page);
    expect(Math.abs(rested.bearing - MAP_ARRIVAL_BEARING_DEG)).toBeLessThanOrEqual(
      BEARING_TOLERANCE,
    );

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
    expect(Math.abs((await readCamera(page)).bearing)).toBeLessThanOrEqual(
      BEARING_TOLERANCE,
    );
    await context.close();
  });
});
