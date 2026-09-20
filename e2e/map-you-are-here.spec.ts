import { expect, test, type Page } from "@playwright/test";

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


async function readReaderDot(page: Page): Promise<{
  hasAccuracyLayer: boolean;
  hasCoreLayer: boolean;
  coordinates: [number, number] | null;
}> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxMapReaderPosition?: {
          read: () => {
            hasAccuracyLayer: boolean;
            hasCoreLayer: boolean;
            coordinates: [number, number] | null;
          };
        };
      }
    ).__pubmaxMapReaderPosition;
    if (!probe) throw new Error("reader position probe missing");
    return probe.read();
  });
}

async function readCameraCenter(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxMapCamera?: { read: () => { center: [number, number] } };
      }
    ).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe missing");
    return probe.read().center;
  });
}

async function projectLngLat(
  page: Page,
  lngLat: [number, number],
): Promise<{ x: number; y: number }> {
  return page.evaluate((point) => {
    const probe = (
      window as typeof window & {
        __pubmaxMapCamera?: { project: (value: [number, number]) => { x: number; y: number } };
      }
    ).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe missing");
    return probe.project(point);
  }, lngLat);
}

test.describe("map you are here dot", () => {
  test("granted location paints a dot that moves without moving the camera", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(["geolocation"]);
    const first = { latitude: 51.515, longitude: -0.09, accuracy: 25 };
    const second = { latitude: 51.518, longitude: -0.085, accuracy: 40 };
    await context.setGeolocation(first);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepareMap(page);

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await arrival.getByRole("button", { name: "Use my location" }).click();

    await expect(page.locator('[data-user-location="shown"]')).toBeVisible({
      timeout: 20_000,
    });

    await expect
      .poll(async () => page.evaluate(() => "__pubmaxMapReaderPosition" in window), {
        timeout: 30_000,
      })
      .toBe(true);

    const dotBefore = await readReaderDot(page);
    expect(dotBefore.hasAccuracyLayer).toBe(true);
    expect(dotBefore.hasCoreLayer).toBe(true);
    expect(dotBefore.coordinates).toEqual([first.longitude, first.latitude]);


    await expect
      .poll(async () => page.evaluate(() => "__pubmaxMapCamera" in window), {
        timeout: 30_000,
      })
      .toBe(true);

    const centerBefore = await readCameraCenter(page);
    const screenBefore = await projectLngLat(page, [first.longitude, first.latitude]);

    await context.setGeolocation(second);

    await expect
      .poll(async () => {
        const screen = await projectLngLat(page, [second.longitude, second.latitude]);
        const dx = Math.abs(screen.x - screenBefore.x);
        const dy = Math.abs(screen.y - screenBefore.y);
        return dx + dy;
      }, { timeout: 20_000 })
      .toBeGreaterThan(8);

    const dotAfter = await readReaderDot(page);
    expect(dotAfter.coordinates).toEqual([second.longitude, second.latitude]);

    const centerAfter = await readCameraCenter(page);
    expect(Math.abs(centerAfter[0] - centerBefore[0])).toBeLessThan(0.0005);
    expect(Math.abs(centerAfter[1] - centerBefore[1])).toBeLessThan(0.0005);

    const layerPresent = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      return Boolean(canvas);
    });
    expect(layerPresent).toBe(true);
  });
});
