import { expect, test, type Page } from "@playwright/test";

import { expectLayoutSettled } from "./helpers/layoutSettled";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

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
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: ARRIVAL_TIMEOUT_MS,
  });
}

test.use({ hasTouch: true, viewport: PHONE, isMobile: true, serviceWorkers: "block" });

test.describe("the first-visit card and the pin field", () => {
  // Each wait above is allowed ARRIVAL_TIMEOUT_MS, but the project's 30 s test
  // budget cut them short: on a slow software-GL runner the card and its pins
  // arrived, and the test ran out of time while the card was still settling
  // (#2276, Browser layout pins 3/3). The budget now covers the waits the
  // spec already declares.
  test.describe.configure({ timeout: 2 * ARRIVAL_TIMEOUT_MS });

  test("closes the unchanged fair-pint card without breaking map paint", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openFirstVisitMap(page);
    const card = page.locator(".fairPintCard:not([data-fair-prelude])");
    await expect(card).toBeVisible();
    await expect.poll(async () => (await paintedPoints(page)).length, {
      timeout: ARRIVAL_TIMEOUT_MS,
    }).toBeGreaterThan(0);
    await expectLayoutSettled(card);

    await card.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expectLayoutSettled(page.locator(".maplibreMap"));
    await expect.poll(async () => (await paintedPoints(page)).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("keeps the fair-pint card under a quarter of the phone screen", async ({ page }) => {
    await openFirstVisitMap(page);
    const card = page.locator(".fairPintCard:not([data-fair-prelude])");
    await expect(card).toBeVisible();
    // The count line is one or two lines once prices answer; measure the answer.
    await expect(card.locator(".fairPintCount")).toContainText("or less", { timeout: ARRIVAL_TIMEOUT_MS });
    await expectLayoutSettled(card);
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(PHONE.height / 4);
    for (const control of await card.getByRole("button").all()) {
      const target = await control.boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("the lower slider edge changes the budget without asking for location", async ({ page }) => {
    await openFirstVisitMap(page);
    const card = page.locator(".fairPintCard:not([data-fair-prelude])");
    await expect(card.locator(".fairPintCount")).toContainText("or less", { timeout: ARRIVAL_TIMEOUT_MS });
    await expectLayoutSettled(card);
    const slider = card.getByRole("slider", { name: "Fair pint price" });
    const before = Number(await slider.inputValue());
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width - 30, box!.y + box!.height - 2);
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(before);
    await expect(card.getByRole("button", { name: "Use my location", exact: true })).toBeVisible();
  });

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

    let points: PaintedPoint[] = [];
    await expect
      .poll(async () => {
        points = await paintedPoints(page);
        return points.length;
      }, {
        timeout: ARRIVAL_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    // Use the successful sample. A new scene update can empty the live probe.
    const [point] = points;
    await page.touchscreen.tap(point.x, point.y);
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  });
});
