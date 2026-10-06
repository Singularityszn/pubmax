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

    // The card arrives on a 160ms rise from 8px low. A box read mid-rise sits
    // up to 8px under the card at rest, and a pin 3px below the resting card
    // (373,635 and 144,635, about one run in ten) read as under it.
    await expectLayoutSettled(card);

    // And the card leaves the upper map clear: it is one row docked low.
    // `boundingBox()` answers x/y/width/height and NOTHING else: reading `.top`
    // off it gave undefined, `undefined + height` gave NaN, and every
    // comparison against NaN is false, so this pair of assertions passed on a
    // card anywhere on the screen until the run of 7 Sep 2026 read them.
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const cardBottom = box!.y + box!.height;
    expect(box!.y + box!.height / 2).toBeGreaterThan(PHONE.height / 2);

    // No reported mark is UNDER the strip. Not "every mark is below it": the
    // probe reported a pin at y 5.5, in the band above the phone's own top bar,
    // which has no chrome over it and is perfectly tappable. What the card may
    // not do is sit on the pin field, and that is what this reads.
    for (const point of await paintedPoints(page)) {
      const insideCard =
        point.y >= box!.y &&
        point.y <= cardBottom &&
        point.x >= box!.x &&
        point.x <= box!.x + box!.width;
      expect(
        insideCard,
        `a tappable mark at ${Math.round(point.x)},${Math.round(point.y)} is under the card`,
      ).toBe(false);
    }
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
