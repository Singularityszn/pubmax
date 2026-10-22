import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { initialFilters } from "../lib/venues";

const MAP_FIRST_VISIT_KEY = "pubmax:map-first-visit-arrival:v1";
const MAP_OPENING_LOCATION_KEY = "pubmax:map-opening-location:v1";
const MOBILE_MAP_SESSION_KEY = "pubmaxx.mobile-map-session.v1";
const CURRENT_FIX = { latitude: 51.515, longitude: -0.09, accuracy: 25 };
const SAVED_VIEW = {
  center: [-0.21, 51.54] as [number, number],
  zoom: 14,
  pitch: 0,
  bearing: 0,
};
const CANONICAL_VENUE_ROWS = JSON.parse(
  readFileSync("public/data/venues_slim.core.json", "utf8"),
).rows as unknown[];
const NATIVE_LOCATION_PERMISSION_STATES = ["granted", "denied", "prompt"] as const;

type NativeLocationPermissionState = (typeof NATIVE_LOCATION_PERMISSION_STATES)[number];
type NativeLocationTrace = { requests: number[]; watches: number[] };

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

async function prepareMap(
  page: Page,
  arrivalKeyState: "first-visit" | "dismissed" = "first-visit",
): Promise<void> {
  await page.addInitScript(({ arrivalKey, arrivalState }) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.removeItem(arrivalKey);
    if (arrivalState === "dismissed") {
      window.localStorage.setItem(arrivalKey, "dismissed");
    }
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
  }, { arrivalKey: MAP_FIRST_VISIT_KEY, arrivalState: arrivalKeyState });
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

async function setNativeGeolocationPermission(
  page: Page,
  origin: string,
  state: NativeLocationPermissionState,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  expect(targetInfo.browserContextId).toBeTruthy();
  await cdp.send("Browser.setPermission", {
    browserContextId: targetInfo.browserContextId!,
    origin,
    permission: { name: "geolocation" },
    setting: state,
  });
  // Detaching resets the native override. The test context owns this session
  // and closes it at teardown, after the real permission state was exercised.
}

async function readNativeLocationTrace(page: Page): Promise<NativeLocationTrace> {
  return page.evaluate(() => {
    const proofWindow = window as typeof window & {
      __locationBrowserProof?: NativeLocationTrace;
    };
    if (!proofWindow.__locationBrowserProof) {
      throw new Error("native geolocation trace missing");
    }
    return {
      requests: [...proofWindow.__locationBrowserProof.requests],
      watches: [...proofWindow.__locationBrowserProof.watches],
    };
  });
}

async function readOpeningLocation(page: Page): Promise<{
  lat: number;
  lng: number;
  savedAt: number;
} | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, MAP_OPENING_LOCATION_KEY);
}

async function readGeolocationPermission(page: Page): Promise<PermissionState> {
  return page.evaluate(async () =>
    (await navigator.permissions.query({ name: "geolocation" })).state,
  );
}

async function prepareRememberedNearMe(page: Page): Promise<void> {
  await page.addInitScript(({ savedView, rows, filters, sessionKey }) => {
    const now = Date.now();
    window.localStorage.setItem("pubmax:map-chosen-area:v1", JSON.stringify({
      cityId: "london",
      kind: "near-me",
      label: "Near me",
      slug: "near-me",
    }));
    window.localStorage.setItem("pubmax:map-opening-location:v1", JSON.stringify({
      lat: savedView.center[1],
      lng: savedView.center[0],
      savedAt: now - 24 * 60 * 60 * 1000,
    }));
    window.localStorage.setItem("map-resume:v1:london", JSON.stringify({
      version: 1,
      cityId: "london",
      savedAt: now - 6 * 24 * 60 * 60 * 1000,
      viewport: savedView,
      rows,
    }));
    window.localStorage.setItem(sessionKey, JSON.stringify({
      version: 1,
      cityId: "london",
      savedAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
      viewport: savedView,
      filters,
      nightArea: null,
      selectedVenueId: null,
      openSheet: null,
    }));

    const proofWindow = window as typeof window & {
      __locationBrowserProof?: NativeLocationTrace;
    };
    const trace: NativeLocationTrace = { requests: [], watches: [] };
    proofWindow.__locationBrowserProof = trace;
    const geolocation = navigator.geolocation;
    const getCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
    const watchPosition = geolocation.watchPosition.bind(geolocation);
    Object.defineProperty(geolocation, "getCurrentPosition", {
      configurable: true,
      value: (...args: Parameters<typeof getCurrentPosition>) => {
        trace.requests.push(performance.now());
        return getCurrentPosition(...args);
      },
    });
    Object.defineProperty(geolocation, "watchPosition", {
      configurable: true,
      value: (...args: Parameters<typeof watchPosition>) => {
        trace.watches.push(performance.now());
        return watchPosition(...args);
      },
    });
  }, {
    savedView: SAVED_VIEW,
    rows: CANONICAL_VENUE_ROWS,
    filters: initialFilters,
    sessionKey: MOBILE_MAP_SESSION_KEY,
  });
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
    // Near-me framing waits for the sheet after the opening-location move.
    // A motionless camera between those moves is not the settled answer.
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("pubmax:camera-intent:nearby").length,
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect
      .poll(async () => (await readCamera(page)).moving, { timeout: 30_000 })
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

  for (const permissionState of NATIVE_LOCATION_PERMISSION_STATES) {
    test(`${permissionState} permission handles remembered Near me on arrival`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.setTimeout(180_000);
      if (!baseURL) throw new Error("Remembered Near me needs the configured map origin.");

      await context.setGeolocation(CURRENT_FIX);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await prepareMap(page, "dismissed");
      await prepareRememberedNearMe(page);
      await setNativeGeolocationPermission(page, new URL(baseURL).origin, permissionState);

      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      const startedAt = Date.now();
      const response = await page.goto("/map");
      expect(response?.status()).toBe(200);
      await expect
        .poll(() => readGeolocationPermission(page), { timeout: 15_000 })
        .toBe(permissionState);
      await waitForPins(page);
      await expect
        .poll(() => page.evaluate(() => "__pubmaxMapCamera" in window), {
          timeout: 30_000,
        })
        .toBe(true);

      if (permissionState === "granted") {
        await expect
          .poll(
            async () => {
              const saved = await readOpeningLocation(page);
              return Boolean(
                saved &&
                  saved.lat === CURRENT_FIX.latitude &&
                  saved.lng === CURRENT_FIX.longitude &&
                  saved.savedAt >= startedAt &&
                  saved.savedAt <= Date.now(),
              );
            },
            { timeout: 45_000 },
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              const calls = await readNativeLocationTrace(page);
              return calls.requests.length > 0 && calls.watches.length > 0;
            },
            { timeout: 45_000 },
          )
          .toBe(true);
        await expect
          .poll(
            () => page.evaluate(() => "__pubmaxMapReaderPosition" in window),
            { timeout: 30_000 },
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              const dot = await readReaderDot(page);
              return [dot.hasSource, dot.hasAccuracyLayer, dot.hasCoreLayer];
            },
            { timeout: 45_000 },
          )
          .toEqual([true, true, true]);
        await expect
          .poll(async () => (await readReaderDot(page)).written, {
            timeout: 45_000,
          })
          .toEqual([CURRENT_FIX.longitude, CURRENT_FIX.latitude]);
        await expect
          .poll(
            async () => {
              const dot = await readReaderDot(page);
              return dot.rendered
                ? metresApart(dot.rendered, [CURRENT_FIX.longitude, CURRENT_FIX.latitude])
                : Number.POSITIVE_INFINITY;
            },
            { timeout: 45_000 },
          )
          .toBeLessThan(20);
        await expect
          .poll(
            async () => {
              const camera = await readCamera(page);
              return (
                !camera.moving &&
                Math.abs(camera.center[0] - CURRENT_FIX.longitude) < 0.04 &&
                Math.abs(camera.center[1] - CURRENT_FIX.latitude) < 0.025
              );
            },
            { timeout: 45_000 },
          )
          .toBe(true);
      } else {
        // Pins and the resumed camera must settle before zero native calls count as evidence.
        await expect
          .poll(
            async () => {
              const [saved, camera] = await Promise.all([
                readOpeningLocation(page),
                readCamera(page),
              ]);
              return (
                saved === null &&
                !camera.moving &&
                metresApart(camera.center, SAVED_VIEW.center) < 5 &&
                Math.abs(camera.zoom - SAVED_VIEW.zoom) < 0.001 &&
                Math.abs(camera.pitch - SAVED_VIEW.pitch) < 0.001 &&
                Math.abs(camera.bearing - SAVED_VIEW.bearing) < 0.001
              );
            },
            { timeout: 60_000 },
          )
          .toBe(true);
        expect(await readNativeLocationTrace(page)).toEqual({
          requests: [],
          watches: [],
        });
      }

      expect(browserErrors).toEqual([]);
    });
  }
});
