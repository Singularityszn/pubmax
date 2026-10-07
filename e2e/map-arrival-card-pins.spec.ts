import { expect, test, type Page } from "@playwright/test";

import { expectLayoutSettled } from "./helpers/layoutSettled";

// The B1 reproduction from the 7 Sep live walk (docs/proof/astra-live-walk/
// report.md), turned into a fence.
//
// Measured then, 3 fresh contexts of 3 at 390x844: `probePins` 0 while the
// first-visit card was up, 32 to 41 the moment it was dismissed. The card was
// read as covering the pins; it covers about a third of the screen, but the
// whole map was untappable, because `interactionLocked` put `inert` on
// `.mapCanvasWrap` and `elementFromPoint` then answers the ancestor rather
// than the canvas at EVERY point on it.
//
// So the claim under test is not "the card is smaller". It is that a
// first-time reader can tap a pub while the card is on screen.

const PHONE = { width: 390, height: 844 };

/** Generous: this suite paints through a software rasteriser on a shared box. */
const ARRIVAL_TIMEOUT_MS = 90_000;

type PaintedPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
};

async function paintedPoints(page: Page): Promise<PaintedPoint[]> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __pubmaxPaintedMapTapPoints?: () => PaintedPoint[];
    }).__pubmaxPaintedMapTapPoints;
    return probe ? probe() : [];
  }) as Promise<PaintedPoint[]>;
}

/** A first visit: the dismissal key the default storage state carries is cleared. */
async function openFirstVisitMap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: ARRIVAL_TIMEOUT_MS,
  });
}

test.use({ hasTouch: true, viewport: PHONE, isMobile: true });

test.describe("the first-visit card and the pin field", () => {
  test("leaves the pins tappable while it is on screen", async ({ page }) => {
    await openFirstVisitMap(page);

    const card = page.locator(".mapArrivalCard");
    await expect(card).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });

    await expect
      .poll(async () => (await paintedPoints(page)).length, {
        timeout: ARRIVAL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    // The card arrives on a 160ms rise from 8px low, so its box is read only
    // once it rests.
    await expectLayoutSettled(card);

    // And the card leaves the upper map clear: it is one row docked low.
    // `boundingBox()` answers x/y/width/height and NOTHING else: reading `.top`
    // off it gave undefined, `undefined + height` gave NaN, and every
    // comparison against NaN is false, so this pair of assertions passed on a
    // card anywhere on the screen until the run of 7 Sep 2026 read them.
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height / 2).toBeGreaterThan(PHONE.height / 2);
  });

  test("goes away on the reader's first gesture on the map", async ({ page }) => {
    await openFirstVisitMap(page);
    const card = page.locator(".mapArrivalCard");
    await expect(card).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });

    await expect
      .poll(async () => (await paintedPoints(page)).length, {
        timeout: ARRIVAL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    const [point] = await paintedPoints(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  });
});
