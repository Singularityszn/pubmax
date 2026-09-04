import { expect, test, type Page } from "@playwright/test";

// A DEEP LINK MUST SHOW THE PIN IT NAMED.
//
// Preview verification, 4 Sept 2026: a cold phone load of
// `/map?sel=<venue>` settled its camera about 420 m north of the pub, so the
// pin the reader had followed a link to projected 338 px BELOW the sheet's top
// edge and stayed hidden until they dragged the sheet down. It is the weakest
// moment in the flow most drinkers use, and it was one sign: MapLibre draws the
// requested centre at the container centre PLUS `offset`, and screen Y grows
// downward, so `mobileSelectCameraOffset` returning a positive Y pushed the pin
// under the sheet rather than above it (lib/sheetSnap.ts).
//
// This is measured in a browser rather than pinned in a unit test because the
// claim is about three things only a rendered map holds at once: where the
// camera settled, where the sheet settled, and where the map is drawing that
// coordinate. The painted-pin probe cannot answer it - `lib/useFocusTrap.ts`
// marks `section.mapStage` inert while the sheet traps focus, so every mark
// fails that probe's own hit test - so the camera probe's `project` is read
// instead, which is what the map itself uses to place the mark.

const PHONE = { width: 390, height: 844 };

// Stable slim-pin id for "Arnos Arms", derived exactly as the app derives it,
// so `?sel=` resolves to a real Venue. Its coordinates are the ones the id is
// built from, which is why they can be projected here.
function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}
function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS = { lng: -0.132117, lat: 51.6162 } as const;
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    ARNOS_ARMS.lat.toFixed(5),
    ARNOS_ARMS.lng.toFixed(5),
  ].join("|"),
);

// Generous on purpose: this project paints through a software rasteriser and
// shares its box, so a slow arrival is a fact about the machine.
const ARRIVAL_TIMEOUT_MS = 90_000;

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

/** Where the map is drawing one coordinate right now, in viewport pixels. */
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

test.use({ hasTouch: true, viewport: PHONE });

test.beforeEach(async ({ page }) => {
  // Reduced motion makes every camera intent an instant jump, so the reading
  // below is the camera's resting place rather than a frame of its travel.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a deep-linked pin lands in the map strip above the phone sheet", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({
    timeout: ARRIVAL_TIMEOUT_MS,
  });
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: ARRIVAL_TIMEOUT_MS,
  });
  await expect
    .poll(async () => page.evaluate(() => "__pubmaxMapCamera" in window), {
      timeout: ARRIVAL_TIMEOUT_MS,
    })
    .toBe(true);

  // The sheet the deep link opened. Its rendered top edge is the whole of what
  // "visible strip" means, so it is measured rather than assumed.
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileSharedSheet.open');
  await expect(sheet).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });

  // The selection move has to have landed before the pin is projected, or this
  // reads a frame of the arrival rather than where the reader is left.
  await expect
    .poll(async () => (await readCamera(page)).moving, { timeout: ARRIVAL_TIMEOUT_MS })
    .toBe(false);

  // The sheet springs open from below the fold, so its first frames report an
  // edge at the bottom of the screen. Wait for the edge it settles at - that
  // is the one the reader is left looking past.
  await expect
    .poll(async () => (await sheet.boundingBox())?.y ?? PHONE.height, {
      timeout: ARRIVAL_TIMEOUT_MS,
    })
    .toBeLessThan(PHONE.height);

  const sheetBox = await sheet.boundingBox();
  expect(sheetBox, "the phone venue sheet has a rendered box").not.toBeNull();
  const sheetTop = sheetBox!.y;

  const pin = await projectOnMap(page, [ARNOS_ARMS.lng, ARNOS_ARMS.lat]);

  // The claim, in one line: the pin the link named is painted in map the
  // reader can see, not under the sheet.
  expect(
    pin.y,
    `pin projected to y ${Math.round(pin.y)} with the sheet's top edge at ${Math.round(sheetTop)}`,
  ).toBeLessThan(sheetTop);
  expect(pin.y, "the pin is on screen, not above the top of it").toBeGreaterThan(0);
  expect(pin.x).toBeGreaterThan(0);
  expect(pin.x).toBeLessThan(PHONE.width);
});
