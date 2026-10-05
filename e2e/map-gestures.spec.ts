import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { getCity } from "@/lib/cities";
import { MAP_ARRIVAL_BEARING_DEG } from "@/lib/mapArrivalBearing";

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
    await dispatchTouch(cdp, "touchMove", pair(-(PITCH_DRAG_PX / PITCH_STEPS) * step));
    await nextFrame(page);
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
    const painted = await paintedPoints(page);
    const pins = painted.filter((point) => point.kind === "pin");
    if (pins.length > 0) return nearestTo(pins);
    const cluster = nearestTo(painted.filter((point) => point.kind === "cluster"));
    expect(cluster, "the map painted no marks at all").toBeTruthy();
    await page.mouse.click(cluster.x, cluster.y);
    await page.waitForTimeout(2_500);
    await expect.poll(async () => (await readCamera(page)).moving, { timeout: 20_000 })
      .toBe(false);
    await page.waitForTimeout(1_500);
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

  const tilted = await readCamera(page);
  // A tilt is a tilt. Nothing else about the camera may come with it.
  expect(Math.abs(tilted.bearing - before.bearing)).toBeLessThan(1);

  // A tilt changes which marks survive symbol collision, so the anchoring
  // claim is made about a pin the map is STILL drawing rather than about one
  // chosen in advance. There has to be one, or the map emptied itself.
  const pinsAfter = await paintedPoints(page);
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
    await page.getByRole("button", { name: "More map controls" }).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Layers" }).click();
    return sheet;
  };
  let sheet = await openLayersTab();
  const reset = sheet.getByRole("button", { name: "Reset view" });
  await expect(reset).toBeVisible();
  await reset.click();

  await expect.poll(
    async () => Math.abs((await readCamera(page)).bearing - LONDON_ATTITUDE.bearing),
    { timeout: 10_000 },
  ).toBeLessThan(0.5);
  const back = await readCamera(page);
  expect(Math.abs(back.pitch - LONDON_ATTITUDE.pitch)).toBeLessThan(0.5);

  // On the city's own attitude there is nothing to reset, so the action is gone.
  await expect(reset).toBeHidden();
  await sheet.getByRole("button", { name: "Close Map controls" }).click();
  sheet = await openLayersTab();
  await expect(sheet.getByRole("button", { name: "Reset view" })).toHaveCount(0);
});
