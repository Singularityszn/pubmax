import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

import recordedSohoWalk from "./fixtures/soho-walk-route.json";

import { getCity } from "@/lib/cities";
import { MAP_ARRIVAL_BEARING_DEG } from "@/lib/mapArrivalBearing";
import { MOBILE_SHEET_DISMISS_EVENT } from "@/lib/mobileShell";
import { expectMapLoadingFrameReleased, mobileMapShellControl } from "./helpers/mobileMapShell";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { holdLondonAfternoon } from "./helpers/themeClock";
import { installNativeShell } from "./helpers/nativeShell";

// The map a reader turns with two fingers, in a real browser with a real
// MapLibre canvas (this spec runs in the `chromium-gl` project).
//
// Captain, 3 Sep 2026: smooth pan, zoom, rotate and tilt with the pins
// anchored, no idle ambient orbit, and one compass that resets the view. Three
// of those are claims a unit test cannot make, because they are about what the
// camera does over time under real touch input:
//
//   1. TWO FINGERS TURN AND TILT IT. Rotate moves the bearing and leaves the
//      pitch; a two-finger drag moves the pitch and leaves the bearing.
//   2. IT THEN HOLDS STILL. The deleted orbit turned the map at 0.6 degrees a
//      second whenever the reader stopped touching it, so the camera is
//      sampled for seconds after the fingers lift and every reading must be
//      the same one.
//   3. THE PINS ARE ANCHORED TO THE GROUND. A mark keeps its own coordinate
//      across the gesture while its painted point moves with the camera, and
//      that painted point is where the camera says that coordinate is.
//
// `window.__pubmaxMapCamera` and `window.__pubmaxPaintedMapTapPoints` are how
// the canvas is observable from outside MapLibre (components/map/canvas/
// cameraProbe.ts, paintedPinProbe.ts). Both are unconditional, because this
// suite runs a production build.

const VIEWPORT = { width: 390, height: 844 };
// The camera actions live in the Layers popover, and that popover is a
// non-phone control (`hideLayersControl={mobileViewport}`, components/
// PubMap.tsx). A touch tablet is where two fingers and the compass both exist.
const TABLET_VIEWPORT = { width: 820, height: 1180 };

/** How far the fingers travel round the circle before they are lifted. */
const ROTATE_ARC_DEGREES = 320;
const ROTATE_STEPS = 40;
/** Radius of the two-finger circle, in viewport pixels. */
const ROTATE_RADIUS_PX = 90;
const MIN_BEARING_CHANGE = 20;

/** How far the two fingers travel up the screen before they are lifted. */
const PITCH_DRAG_PX = 420;
const PITCH_STEPS = 60;
const MIN_PITCH_CHANGE = 8;
// MapLibre reads two fingers that lift within 30px of where they landed, inside
// half a second, as a two-finger tap and zooms the map out
// (maplibre-gl/src/ui/handler/tap_recognizer.ts). The tilt travels past that.
const MIN_TILT_TRAVEL_PX = 40;
// MapLibre's `bearingSnap` default, which the canvas keeps: a gesture that ends
// within this many degrees of north eases the map to north. The 4-degree
// arrival turn is inside it.
const MAPLIBRE_BEARING_SNAP_DEG = 7;

/** How long the camera is watched for movement nobody asked for. */
const STILLNESS_WINDOW_MS = 4_000;
const STILLNESS_SAMPLES = 8;

/** What the compass promises to hand back. The control reads the same table. */
const LONDON_ATTITUDE = getCity("london").mapView;

type CameraReading = {
  bearing: number;
  pitch: number;
  zoom: number;
  center: [number, number];
  moving: boolean;
  settling: boolean;
};

type PaintedPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
};

test.use({ hasTouch: true, viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const { width, height, delayedRoad, southEast = false } of [
  { width: 768, height: 390, delayedRoad: false }, { width: 844, height: 390, delayedRoad: false },
  { width: 844, height: 390, delayedRoad: true }, { width: 768, height: 1024, delayedRoad: true },
  { width: 844, height: 390, delayedRoad: true, southEast: true },
  { width: 390, height: 844, delayedRoad: true },
]) for (const theme of ["light", "dark"]) {
  test(`a ${height > width ? "portrait" : "short landscape"} walk keeps Ask and every stop tappable at ${width}px in ${theme}${delayedRoad ? " after a held road and resize" : ""}${southEast ? " with a southeast stop" : ""}`, async ({ page }, testInfo) => {
    const stopIds = southEast ? ["venue-nyowgc", "venue-xiesdn", "venue-15i2wst"]
      : ["venue-7tarkc", "venue-122cuu1", "venue-s2ppfm"];
    const coordinates: [number, number][] = southEast
      ? [[-0.137432, 51.5149], [-0.132014, 51.514], [-0.131572, 51.5125]]
      : [[-0.134383, 51.5113], [-0.135402, 51.5108], [-0.135301, 51.5106]];
    const openingViewport = height > width ? { width: 844, height: 390 } : { width, height };
    await page.setViewportSize(openingViewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await holdLondonAfternoon(page);
    await page.addInitScript(theme => {
      localStorage.setItem("pubmax-theme", theme);
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    }, theme);
    if (width === 844 || width === 390) await installNativeShell(page, "ios");
    await installDeterministicMapBasemap(page);
    await page.route("**/api/citymcp/status**", route => route.fulfill({ json: {
      asOf: null, weather: null, tubeLines: [], signals: [],
    } }));
    await page.route("**/api/whats-on**", route => route.fulfill({ json: {
      servedAt: "2026-10-30T14:00:00Z", rows: [], asOf: null,
      sourceObservedAt: null, sourceFreshnessKind: "unknown",
    } }));
    await page.route("**/api/citymcp/things-to-do**", route => route.fulfill({ json: { opportunities: [] } }));
    let releaseRoad = () => {};
    const roadGate = new Promise<void>(resolve => { releaseRoad = resolve; });
    page.on("close", releaseRoad);
    await page.route("**/api/walk-route?**", async route => {
      if (delayedRoad) {
        await roadGate;
        await route.fulfill({ json: southEast ? { line: { type: "FeatureCollection", features: [{
          type: "Feature", properties: { source: "straight" },
          geometry: { type: "LineString", coordinates },
        }] }, source: "straight" } : recordedSohoWalk });
      } else await route.fulfill({
        status: 503, json: { error: "Walking route unavailable.", code: "UNAVAILABLE", retryable: true },
      });
    });
    await page.goto(`/map?mode=build&pubs=${stopIds.join(",")}`);
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-route-stops", "3");
    await expectMapLoadingFrameReleased(page);
    await expect(page.locator(".palSummonSignIn")).toBeVisible();
    const readStops = () => page.evaluate(coordinates => {
      const camera = (window as typeof window & {
        __pubmaxMapCamera: { read(): CameraReading; project(point: [number, number]): { x: number; y: number } };
      }).__pubmaxMapCamera;
      const canvas = document.querySelector(".maplibregl-canvas");
      // The route disc has a 16px radius and a 2.5px stroke. Sample its rim,
      // since a clear centre alone allows chrome to cover the numbered stop.
      const offsets = [[0, 0], [-22, 0], [22, 0], [0, -22], [0, 22], [-16, -16], [16, -16], [-16, 16], [16, 16]];
      const points = coordinates.map(coordinate => camera.project(coordinate));
      const state = camera.read();
      return { settled: !state.moving && !state.settling, zoom: state.zoom, center: state.center, points,
        obstructions: points.map(point => offsets.map(([x, y]) => {
          const hit = document.elementFromPoint(point.x + x!, point.y + y!);
          return hit === canvas ? null : hit?.className ?? "outside viewport";
        }).filter(Boolean)) };
    }, coordinates);
    const expectClearStops = async (stage: string) => {
      await expect.poll(async () => (await readStops()).settled).toBe(true);
      await testInfo.attach(`${stage}-geometry`, { body: JSON.stringify(await readStops()), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath(`${stage}-view.png`) });
      await expect.poll(async () => (await readStops()).obstructions,
        { message: "Every numbered stop rim must clear the toolbar and map controls" }).toEqual([[], [], []]);
    };
    await expectClearStops("initial");
    const ask = page.getByRole("button", { name: "Ask the map", exact: true });
    await expect(ask).toBeVisible();
    const box = await ask.boundingBox();
    expect(box?.width).toBe(44);
    expect(box?.height).toBe(44);
    await page.route("**/api/ask", route => route.fulfill({ json: {
      answer: "No verified answer for this browser fixture.", cards: [], proposals: [], status: "ready",
    } }));
    const dialog = page.getByRole("dialog", { name: "Ask the map about a pub" });
    const expectUncovered = async (control: Locator) => {
      await control.scrollIntoViewIfNeeded();
      const hits = await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return [[4, box.height / 2], [box.width - 4, box.height / 2],
          [box.width / 2, 4], [box.width / 2, box.height - 4], [box.width / 2, box.height / 2]]
          .map(([x, y]) => {
            const hit = document.elementFromPoint(box.left + x!, box.top + y!);
            return element.contains(hit) ? null : { hit: hit?.className, x: box.left + x!, y: box.top + y!, box: box.toJSON() };
          }).filter(Boolean);
      });
      if (hits.length) await page.screenshot({ path: testInfo.outputPath("obstructed-control.png") });
      expect(hits, "The entire actionable control must receive taps").toEqual([]);
    };
    const exerciseAsk = async (stage: "initial" | "recovered") => {
      await ask.tap();
      await expect(dialog).toBeVisible();
      if (delayedRoad && stage === "initial") {
        const initialZoom = (await readStops()).zoom;
        const response = page.waitForResponse(response => response.url().includes("/api/walk-route?") && response.ok());
        releaseRoad();
        await response;
        if (!southEast) await expect.poll(async () => Math.abs((await readStops()).zoom - initialZoom)).toBeGreaterThan(0.001);
        const roadZoom = (await readStops()).zoom;
        const refitViewport = width <= 640 ? openingViewport : { width, height };
        await page.setViewportSize({ width: refitViewport.width - 10, height: refitViewport.height - 10 });
        await expect.poll(async () => Math.abs((await readStops()).zoom - roadZoom)).toBeGreaterThan(0.001);
        await expect.poll(async () => (await readStops()).settled).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`${stage}-ask-open.png`) });
      const close = dialog.getByRole("button", { name: "Close ask", exact: true });
      await expectUncovered(close);
      const examples = dialog.locator(".mapConciergeAskChip");
      await expect(examples).toHaveCount(stage === "initial" || width <= 640 ? 4 : 0);
      for (const example of await examples.all()) await expectUncovered(example);
      if (await examples.count()) {
        const request = page.waitForRequest(request => request.url().endsWith("/api/ask") && request.method() === "POST");
        await examples.first().tap();
        expect((await request).postDataJSON().query).toBe("Quiet-ish near Bank, 4 of us");
        await expect(dialog.getByText("No verified answer for this browser fixture.", { exact: true })).toBeVisible();
      }
      const input = dialog.locator("input");
      await expectUncovered(input);
      await input.tap();
      await input.fill("Tube delays right now");
      const submit = dialog.getByRole("button", { name: "Ask", exact: true });
      await expectUncovered(submit);
      const request = page.waitForRequest(request => request.url().endsWith("/api/ask") && request.method() === "POST");
      await submit.tap();
      expect((await request).postDataJSON().query).toBe("Tube delays right now");
      await expect(submit).toBeEnabled();
      await expectUncovered(close);
      await close.tap();
      await expect(ask).toBeVisible();
    };
    await exerciseAsk("initial");
    // Ask belongs to the wider shell. Phone portrait restores its own chrome.
    if (width <= 640) await page.setViewportSize({ width, height });
    await expectClearStops("after-ask");
    // Each disc must select its own venue, including the close Soho pair.
    for (const [index, id] of stopIds.entries()) {
      const walk = await readStops();
      const stop = walk.points[index]!;
      await page.touchscreen.tap(stop.x, stop.y);
      await expect(page).toHaveURL(new RegExp(`sel=${id}`));
      const close = page.getByRole("button", { name: "Close pub detail", exact: true });
      await expect(close).toBeVisible();
      await expect.poll(async () => Math.hypot(...(await readStops()).center.map((value, axis) => value - walk.center[axis]!))).toBeGreaterThan(0.0000001);
      await expect.poll(async () => (await readStops()).settled).toBe(true);
      const selected = await readStops();
      await close.tap();
      await expect(page).not.toHaveURL(/sel=/);
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
      await expect.poll(async () => Math.hypot(...(await readStops()).center.map((value, axis) => value - selected.center[axis]!))).toBeGreaterThan(0.0000001);
      await expectClearStops(`recovered-${index + 1}`);
    }
    if (height > width) {
      await page.setViewportSize(openingViewport);
      await page.getByRole("button", { name: "Show whole walk", exact: true }).tap();
      await expectClearStops("landscape-return");
    }
    await exerciseAsk("recovered");
  });
}

for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
  test(`closing a stop preserves the camera after ${key} panning`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?mode=build&pubs=venue-7tarkc,venue-122cuu1,venue-s2ppfm&sel=venue-7tarkc");
    const close = page.getByRole("button", { name: "Close pub detail", exact: true });
    await expect(close).toBeVisible();
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-route-stops", "3");
    await expect(page.locator(".mapLoading")).toHaveCount(0);
    await expect.poll(async () => {
      const state = await readCamera(page);
      return !state.moving && !state.settling;
    }).toBe(true);
    const before = await readCamera(page);
    const canvas = page.locator(".maplibregl-canvas");
    await canvas.focus();
    await canvas.press(key);
    await expect.poll(async () => {
      const state = await readCamera(page);
      return !state.moving && !state.settling
        && Math.hypot(state.center[0] - before.center[0], state.center[1] - before.center[1]) > 0.00001;
    }).toBe(true);
    const panned = await readCamera(page);
    await close.click();
    await expect(close).not.toBeVisible();
    await expect.poll(async () => {
      const state = await readCamera(page);
      return !state.moving && !state.settling;
    }).toBe(true);
    // The reader's chosen view is the oracle. A route fit after closure
    // changes the centre or zoom and must fail this check.
    const after = await readCamera(page);
    expect(after.center[0]).toBeCloseTo(panned.center[0], 7);
    expect(after.center[1]).toBeCloseTo(panned.center[1], 7);
    expect(after.zoom).toBeCloseTo(panned.zoom, 7);
    expect(after.bearing).toBeCloseTo(panned.bearing, 7);
    expect(after.pitch).toBeCloseTo(panned.pitch, 7);
  });
}

for (const exit of ["close button", "direct dismiss"] as const) {
  for (const moved of [false, true]) {
    test(`a cold mapped walk resolves after ${exit}, reader panned: ${moved}`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await installDeterministicMapBasemap(page);
      await page.addInitScript(() => localStorage.setItem("pubmax-theme", "light"));
      const delayedId = "venue-122cuu1";
      const details = await Promise.all(["venue-7tarkc", delayedId].map(async id => {
        const response = await request.get(`/api/venue/${id}`);
        expect(response.ok()).toBe(true);
        return response.json();
      }));
      await page.route("**/api/venue/venue-7tarkc*", route => route.fulfill({ json: details[0] }));
      const core = await (await request.get("/data/venues_slim.core.json")).json();
      const manifest = await (await request.get("/data/venues_slim.manifest.json")).json();
      const rows = core.rows.filter((row: { id: string }) => row.id !== delayedId);
      let releaseVenue!: () => void;
      let requested = false;
      const venueReady = new Promise<void>(resolve => { releaseVenue = resolve; });
      page.on("close", releaseVenue);
      await page.route(/\/data\/venues_slim(?:\.[^/?]+)?\.json(?:\?.*)?$/, route => route.fulfill({ json: { ...core, rows } }));
      await page.route("**/data/venues_slim.manifest.json*", route => route.fulfill({ json: {
        ...manifest, shards: [{ id: "cold-walk", core: true, partition: "grid", url: "/data/venues_slim.core.json",
          count: rows.length, bbox: [-0.4, 51.3, 0.2, 51.8] }],
      } }));
      await page.route(`**/api/venue/${delayedId}*`, async route => {
        requested = true;
        await venueReady;
        if (!page.isClosed()) await route.fulfill({ json: details[1] });
      });
      await page.route("**/api/walk-route?**", route => route.fulfill({
        status: 503, json: { error: "Walking route unavailable.", code: "UNAVAILABLE", retryable: true },
      }));
      try {
        await page.goto(`/map?mode=build&pubs=venue-7tarkc,${delayedId}&sel=venue-7tarkc`);
        const close = page.getByRole("button", { name: "Close pub detail", exact: true });
        await expect(close).toBeVisible();
        await expect.poll(() => requested).toBe(true);
        await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-route-stops", "0");
        await expectMapLoadingFrameReleased(page);
        await expect.poll(async () => {
          const state = await readCamera(page);
          return !state.moving && !state.settling;
        }).toBe(true);
        const selected = await readCamera(page);
        if (moved) {
          const canvas = page.locator(".maplibregl-canvas");
          await canvas.focus();
          await canvas.press("ArrowRight");
          await expect.poll(async () => {
            const state = await readCamera(page);
            return !state.moving && Math.abs(state.center[0] - selected.center[0]) > 0.00001;
          }).toBe(true);
        }
        const held = await readCamera(page);
        await testInfo.attach("before-close", { body: await page.screenshot(), contentType: "image/png" });
        if (exit === "close button") await close.click();
        else await page.evaluate(event => window.dispatchEvent(new CustomEvent(event)), MOBILE_SHEET_DISMISS_EVENT);
        await expect(close).not.toBeVisible();
        const resolved = page.waitForResponse(response => response.url().includes(`/api/venue/${delayedId}`) && response.ok());
        releaseVenue();
        await (await resolved).finished();
        await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-route-stops", "2");
        await expect.poll(() => page.evaluate(() => (window as typeof window & {
          __pubmaxPaintedMapTapPoints?: { state?: () => { sourceLoaded: Record<string, boolean | null> } };
        }).__pubmaxPaintedMapTapPoints?.state?.().sourceLoaded["route-stops"])).toBe(true);
        if (moved) {
          await expect.poll(async () => {
            const state = await readCamera(page);
            return !state.moving && !state.settling;
          }).toBe(true);
          const after = await readCamera(page);
          expect(after.center[0]).toBeCloseTo(held.center[0], 7);
          expect(after.center[1]).toBeCloseTo(held.center[1], 7);
          expect(after.zoom).toBeCloseTo(held.zoom, 7);
        } else {
          // Compare with the settled venue camera as well as the route band.
          // Two visible projected stops alone do not prove recovery occurred.
          await expect.poll(async () => {
            const state = await readCamera(page);
            const points = await Promise.all([
              projectOnMap(page, [-0.134383, 51.5113]), projectOnMap(page, [-0.135402, 51.5108]),
            ]);
            return !state.moving && !state.settling
              && (Math.abs(state.zoom - held.zoom) > 0.1
                || Math.hypot(state.center[0] - held.center[0], state.center[1] - held.center[1]) > 0.0001)
              && points.every(point =>
              point.x >= 72 && point.x <= 1368 && point.y >= 300 && point.y <= 720)
              && Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y) >= 160;
          }).toBe(true);
        }
        await testInfo.attach("camera-transition", { body: JSON.stringify({ selected, held, after: await readCamera(page) }),
          contentType: "application/json" });
        await testInfo.attach("after-resolution", { body: await page.screenshot(), contentType: "image/png" });
      } finally {
        releaseVenue();
      }
    });
  }
}

async function readCamera(page: Page): Promise<CameraReading> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxMapCamera?: { read: () => CameraReading };
    }).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe absent");
    return probe.read();
  }) as Promise<CameraReading>;
}

async function paintedPoints(page: Page): Promise<PaintedPoint[]> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxPaintedMapTapPoints?: () => PaintedPoint[];
    }).__pubmaxPaintedMapTapPoints;
    return probe ? probe() : [];
  }) as Promise<PaintedPoint[]>;
}

/**
 * Where the camera says one coordinate is right now, in the same viewport
 * pixels the painted probe answers in.
 */
async function projectOnMap(
  page: Page,
  lngLat: [number, number],
): Promise<{ x: number; y: number }> {
  return page.evaluate((coordinate) => {
    const probe = (window as unknown as {
      __pubmaxMapCamera?: { project: (value: [number, number]) => { x: number; y: number } };
    }).__pubmaxMapCamera;
    if (!probe) throw new Error("camera probe absent");
    return probe.project(coordinate);
  }, lngLat);
}

/**
 * How long arrival is given.
 *
 * Generous on purpose: this suite paints through a software rasteriser and
 * shares its box, so a slow arrival is a fact about the machine rather than
 * about the map. Every assertion below the wait is unchanged by it.
 */
const ARRIVAL_TIMEOUT_MS = 90_000;

async function openMap(page: Page): Promise<void> {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });
  await expect.poll(
    async () => page.evaluate(() => "__pubmaxMapCamera" in window),
    { timeout: ARRIVAL_TIMEOUT_MS },
  ).toBe(true);
  // Marks first: the anchoring claim needs one, and a gesture driven before the
  // pins paint would be measuring an empty canvas.
  await expect.poll(async () => (await paintedPoints(page)).length, { timeout: ARRIVAL_TIMEOUT_MS })
    .toBeGreaterThan(0);
  // The camera has to be at rest before a gesture, or the arrival move would be
  // mistaken for the reader's own.
  await expect.poll(async () => (await readCamera(page)).moving, { timeout: ARRIVAL_TIMEOUT_MS })
    .toBe(false);
  // And it has to have ARRIVED. A cold map opens flat north and then makes its
  // opening turn, and a gesture driven into that half-arrived camera is
  // measuring the wrong map. The turned bearing is the honest signal that
  // arrival is done.
  await expect.poll(async () => {
    const camera = await readCamera(page);
    return Math.abs(camera.bearing - MAP_ARRIVAL_BEARING_DEG) < 0.5
      && Math.abs(camera.pitch - LONDON_ATTITUDE.pitch) < 0.5;
  }, { timeout: ARRIVAL_TIMEOUT_MS }).toBe(true);
  // The probe polls above run queryRenderedFeatures, which occupies the render
  // thread. A gesture driven into a busy renderer has its moves coalesced, and
  // a coalesced two-finger turn arrives as one move below MapLibre's own
  // rotation threshold, so let the scene quieten first.
  await page.waitForTimeout(1_500);
}

/**
 * Wait for the page to paint.
 *
 * Chromium coalesces touchmove to the frame rate, so a gesture paced on a
 * timer loses moves whenever a frame runs long - and on the software
 * rasteriser this suite uses, frames run very long. Pacing on the page's own
 * frames delivers each move separately however slow the box is.
 */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

type TouchPoint = { x: number; y: number };

async function dispatchTouch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points: TouchPoint[],
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    // Each finger needs its OWN id, or the protocol delivers one touch and
    // MapLibre's two-finger handlers never see a second point.
    touchPoints: points.map((point, index) => ({
      x: Math.round(point.x),
      y: Math.round(point.y),
      id: index + 1,
      radiusX: 12,
      radiusY: 12,
      force: 1,
    })),
  });
}

/**
 * One two-finger turn about the middle of the canvas.
 *
 * The fingers stay down until the map has really turned. Chromium coalesces
 * touchmove to the frame rate and this suite paints through a software
 * rasteriser, so a fixed number of moves can arrive as one move too small to
 * pass MapLibre's own rotation threshold - and a gesture that has been lifted
 * cannot be resumed. A person keeps turning until the map turns, so the
 * gesture does too, and stops the moment it has.
 */
async function twoFingerRotate(
  page: Page,
  cdp: CDPSession,
  centre: TouchPoint,
): Promise<void> {
  await dispatchTouch(cdp, "touchStart", rotatePair(centre, ROTATE_RADIUS_PX, 0));
  const start = (await readCamera(page)).bearing;
  for (let step = 1; step <= ROTATE_STEPS; step += 1) {
    await dispatchTouch(
      cdp,
      "touchMove",
      rotatePair(centre, ROTATE_RADIUS_PX, (ROTATE_ARC_DEGREES / ROTATE_STEPS) * step),
    );
    await nextFrame(page);
    if (Math.abs((await readCamera(page)).bearing - start) > MIN_BEARING_CHANGE) break;
  }
  await dispatchTouch(cdp, "touchEnd", []);
}

/** One two-finger drag up the screen, held for the same reason. */
async function twoFingerTilt(
  page: Page,
  cdp: CDPSession,
  centre: TouchPoint,
): Promise<void> {
  const pair = (offset: number): TouchPoint[] => [
    { x: centre.x - 40, y: centre.y + 60 + offset },
    { x: centre.x + 40, y: centre.y + 60 + offset },
  ];
  await dispatchTouch(cdp, "touchStart", pair(0));
  const start = (await readCamera(page)).pitch;
  for (let step = 1; step <= PITCH_STEPS; step += 1) {
    const travelled = (PITCH_DRAG_PX / PITCH_STEPS) * step;
    await dispatchTouch(cdp, "touchMove", pair(-travelled));
    await nextFrame(page);
    if (travelled < MIN_TILT_TRAVEL_PX) continue;
    if (Math.abs((await readCamera(page)).pitch - start) > MIN_PITCH_CHANGE) break;
  }
  await dispatchTouch(cdp, "touchEnd", []);
}

/** Two fingers on a circle, turned about the middle of the canvas. */
function rotatePair(centre: TouchPoint, radius: number, degrees: number): TouchPoint[] {
  const angle = (degrees * Math.PI) / 180;
  return [
    { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) },
    { x: centre.x - radius * Math.cos(angle), y: centre.y - radius * Math.sin(angle) },
  ];
}

/**
 * Open the gathered pubs until a single pin is painted, and answer the one
 * nearest the middle of the canvas: it is the mark most likely to survive the
 * move, so it is the one worth watching.
 */
async function openAPin(page: Page, centre: TouchPoint): Promise<PaintedPoint> {
  const nearestTo = (points: PaintedPoint[]) => points
    .slice()
    .sort((left, right) =>
      Math.hypot(left.x - centre.x, left.y - centre.y)
      - Math.hypot(right.x - centre.x, right.y - centre.y))[0];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    let painted: PaintedPoint[] = [];
    await expect.poll(async () => {
      painted = await paintedPoints(page);
      return painted.length;
    }).toBeGreaterThan(0);
    const pins = painted.filter((point) => point.kind === "pin");
    if (pins.length > 0) return nearestTo(pins);
    const cluster = nearestTo(painted.filter((point) => point.kind === "cluster"));
    expect(cluster, "the map painted no marks at all").toBeTruthy();
    const zoomBefore = (await readCamera(page)).zoom;
    await page.mouse.click(cluster.x, cluster.y);
    await expect.poll(async () => (await readCamera(page)).zoom).toBeGreaterThan(zoomBefore);
    await expect.poll(async () => (await readCamera(page)).moving, { timeout: 20_000 })
      .toBe(false);
    await expect.poll(async () => (await paintedPoints(page)).length).toBeGreaterThan(0);
  }
  throw new Error("no pub pin painted after opening the clusters");
}

async function canvasCentre(page: Page): Promise<TouchPoint> {
  const box = await page.locator(".maplibreMap canvas").first().boundingBox();
  if (!box) throw new Error("no map canvas");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("two fingers turn the map, and it holds the bearing they left", async ({ page }) => {
  test.setTimeout(240_000);
  await openMap(page);
  const cdp = await page.context().newCDPSession(page);
  const centre = await canvasCentre(page);
  const before = await readCamera(page);

  await twoFingerRotate(page, cdp, centre);

  await expect.poll(
    async () => Math.abs((await readCamera(page)).bearing - before.bearing),
    { timeout: 10_000 },
  ).toBeGreaterThan(MIN_BEARING_CHANGE);

  const turned = await readCamera(page);
  // A rotate is a rotate. Nothing else about the camera may come with it.
  expect(Math.abs(turned.pitch - before.pitch)).toBeLessThan(1);
  expect(Math.abs(turned.zoom - before.zoom)).toBeLessThan(0.2);

  // The whole point of deleting the idle orbit: this is now a still map.
  const readings: CameraReading[] = [];
  for (let sample = 0; sample < STILLNESS_SAMPLES; sample += 1) {
    await page.waitForTimeout(STILLNESS_WINDOW_MS / STILLNESS_SAMPLES);
    readings.push(await readCamera(page));
  }
  for (const reading of readings) {
    expect(
      Math.abs(reading.bearing - turned.bearing),
      "the camera turned with nobody touching it",
    ).toBeLessThan(0.001);
    expect(Math.abs(reading.pitch - turned.pitch)).toBeLessThan(0.001);
    expect(Math.abs(reading.center[0] - turned.center[0])).toBeLessThan(0.000001);
    expect(Math.abs(reading.center[1] - turned.center[1])).toBeLessThan(0.000001);
  }
});

test("two fingers tilt the map, and the pins stay on the ground", async ({ page }) => {
  test.setTimeout(240_000);
  await openMap(page);
  const cdp = await page.context().newCDPSession(page);
  const centre = await canvasCentre(page);

  // The anchor has to be a PIN. The map opens with the pubs gathered, and a
  // cluster's id is re-minted every time the marks are re-clustered, so a
  // cluster could not be recognised after the camera moved even though the
  // pubs inside it never went anywhere. Opening a cluster is the product's own
  // way to a pin.
  await openAPin(page, centre);
  const pinsBefore = (await paintedPoints(page)).filter((point) => point.kind === "pin");
  expect(pinsBefore.length, "the map painted no pub pins").toBeGreaterThan(0);
  for (const pin of pinsBefore) {
    const projected = await projectOnMap(page, [pin.lng, pin.lat]);
    expect(Math.abs(pin.x - projected.x)).toBeLessThan(0.5);
    expect(Math.abs(pin.y - projected.y)).toBeLessThan(0.5);
  }

  // Read the camera AFTER the clusters were opened: getting to a pin is itself
  // a camera move, so the pre-tilt attitude is the one it left behind.
  const before = await readCamera(page);
  await twoFingerTilt(page, cdp, centre);

  await expect.poll(
    async () => Math.abs((await readCamera(page)).pitch - before.pitch),
    { timeout: 10_000 },
  ).toBeGreaterThan(MIN_PITCH_CHANGE);
  // The fingers lift as soon as the pitch passes the threshold, and MapLibre
  // can still be easing the tilt out. A pin painted mid-ease and the camera
  // projected a frame later disagree by a pixel or two, so the anchoring claim
  // is only made about a camera at rest.
  await expect.poll(async () => {
    const camera = await readCamera(page);
    return !camera.moving && !camera.settling;
  }, { timeout: 20_000 }).toBe(true);

  const tilted = await readCamera(page);
  // A tilt is a tilt. Nothing else about the camera may come with it, except
  // MapLibre's own snap to north when the gesture ends near it.
  const restingBearing = Math.abs(before.bearing) < MAPLIBRE_BEARING_SNAP_DEG ? 0 : before.bearing;
  expect(Math.abs(tilted.bearing - restingBearing)).toBeLessThan(1);
  expect(Math.abs(tilted.zoom - before.zoom)).toBeLessThan(0.01);

  // A tilt changes which marks survive symbol collision, so the anchoring
  // claim is made about a pin the map is STILL drawing rather than about one
  // chosen in advance. There has to be one, or the map emptied itself.
  let pinsAfter: PaintedPoint[] = [];
  await expect.poll(async () => {
    pinsAfter = await paintedPoints(page);
    return pinsBefore.some((pin) => pinsAfter.some((point) => point.id === pin.id));
  }).toBe(true);
  const before2 = pinsBefore.find((pin) => pinsAfter.some((point) => point.id === pin.id));
  expect(before2, "not one pin survived the tilt").toBeTruthy();
  if (!before2) return;
  const same = pinsAfter.find((point) => point.id === before2.id);
  if (!same) return;
  // Where it IS never moved.
  expect(same.lng).toBeCloseTo(before2.lng, 10);
  expect(same.lat).toBeCloseTo(before2.lat, 10);
  // Where it is DRAWN did move, which is a mark on the ground rather than one
  // stuck to the glass.
  expect(Math.hypot(same.x - before2.x, same.y - before2.y)).toBeGreaterThan(1);
  // And it is drawn exactly where the camera says that coordinate is.
  const projectedAfter = await projectOnMap(page, [same.lng, same.lat]);
  expect(Math.abs(same.x - projectedAfter.x)).toBeLessThan(0.5);
  expect(Math.abs(same.y - projectedAfter.y)).toBeLessThan(0.5);
});

// The popover that owns the desktop compass is hidden under the 640px query. A
// phone gets the same reset as a "Reset view" action in the Layers tab of Map
// controls (docs/proof/red-on-main-2026-09.md R19). This block runs where the
// popover ships, so the proof is of the shipped control.
test.describe("the compass, where the map has one", () => {
  test.use({ hasTouch: true, viewport: TABLET_VIEWPORT });

  test("one compass, and it gives back the view the city opens on", async ({ page }) => {
    test.setTimeout(240_000);
    await openMap(page);
    const opening = await readCamera(page);
    // MapLibre's own compass is off at the source: two controls answering the
    // same question differently is worse than either. The app's one compass is
    // owned by the Layers popover, not the retired map edge.
    await expect(page.locator(".maplibregl-ctrl-compass")).toHaveCount(0);
    const layersFab = page.locator(".mapLayersControl > .mapLayersFab");
    const layersPanel = page.locator(".mapLayersControl > .mapLayersPanel");
    const openLayersCompass = async () => {
      await expect(async () => {
        if (!(await layersPanel.isVisible())) await layersFab.click();
        await expect(layersPanel.locator(".mapCompassBtn")).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const compass = layersPanel.locator(".mapCompassBtn");
      await expect(page.locator(".mapCompassBtn")).toHaveCount(1);
      return compass;
    };
    let compass = await openLayersCompass();
    await expect(compass).toHaveAttribute("aria-label", /^Reset the map view of /);

    // The popover covers the map's lower right, and a finger that lands on it
    // is not a gesture MapLibre ever sees. Close it, turn the map, reopen it.
    await page.keyboard.press("Escape");
    await expect(layersPanel).toBeHidden();

    const cdp = await page.context().newCDPSession(page);
    const centre = await canvasCentre(page);
    await twoFingerRotate(page, cdp, centre);
    await expect.poll(
      async () => Math.abs((await readCamera(page)).bearing - opening.bearing),
      { timeout: 10_000 },
    ).toBeGreaterThan(MIN_BEARING_CHANGE);

    // The control is still there on a turned map. The old one was not, which is
    // the exact moment somebody wants it. A gesture starts outside the popover,
    // so reopen its owner if the outside-pointer handler closed it.
    compass = await openLayersCompass();
    await expect(compass).toBeVisible();
    await compass.click();

    // It hands back the attitude the CITY is designed to open on - both axes -
    // rather than flat north, which is a view this map never has.
    await expect.poll(
      async () => Math.abs((await readCamera(page)).bearing - LONDON_ATTITUDE.bearing),
      { timeout: 10_000 },
    ).toBeLessThan(0.5);
    const reset = await readCamera(page);
    expect(Math.abs(reset.pitch - LONDON_ATTITUDE.pitch)).toBeLessThan(0.5);
    expect(LONDON_ATTITUDE.pitch).toBeGreaterThan(0);
  });
});

test("a phone turns and tilts the map, and Reset view in the Layers tab gives back the view", async ({ page }) => {
  test.setTimeout(240_000);
  await openMap(page);
  const opening = await readCamera(page);
  const cdp = await page.context().newCDPSession(page);
  const centre = await canvasCentre(page);
  await twoFingerRotate(page, cdp, centre);
  await twoFingerTilt(page, cdp, centre);
  await expect.poll(
    async () => Math.abs((await readCamera(page)).bearing - opening.bearing),
    { timeout: 10_000 },
  ).toBeGreaterThan(MIN_BEARING_CHANGE);

  const openLayersTab = async () => {
    await (await mobileMapShellControl(page, "more")).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Layers" }).click();
    return sheet;
  };
  let sheet = await openLayersTab();
  const reset = sheet.getByRole("button", { name: "Reset view", exact: true });
  await expect(reset).toBeEnabled();
  await reset.click();

  // The reset eases bearing and pitch together, so read the attitude it hands
  // back once the camera is at rest rather than mid-ease.
  await expect.poll(async () => {
    const camera = await readCamera(page);
    return !camera.moving && !camera.settling;
  }, { timeout: 20_000 }).toBe(true);
  const back = await readCamera(page);
  expect(Math.abs(back.bearing - LONDON_ATTITUDE.bearing)).toBeLessThan(0.5);
  expect(Math.abs(back.pitch - LONDON_ATTITUDE.pitch)).toBeLessThan(0.5);

  // On the city's own attitude there is nothing to reset, so the action stays
  // in place and is disabled.
  await expect(reset).toBeVisible();
  await expect(reset).toBeDisabled();
  await sheet.getByRole("button", { name: "Close Map controls" }).click();
  sheet = await openLayersTab();
  await expect(sheet.getByRole("button", { name: "Reset view", exact: true })).toBeDisabled();
});
