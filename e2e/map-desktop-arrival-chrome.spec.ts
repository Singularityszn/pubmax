import { expect, test, type Page } from "@playwright/test";

import { paintedAmbientSurfaces } from "./helpers/ambientMapSurfaces";
import { expectSoleDesktopDrawer, desktopVenueDrawer } from "./helpers/mapSurfaceDrawers";
import { expectMapToolbarReady, selectFirstToolbarVenue } from "./helpers/mapToolbar";

// What a desktop reader meets before they have touched anything.
//
// Measured on a production build at 1440x900, 7 Sep 2026 (docs/proof/
// astra-live-walk/report.md B9): EIGHTEEN interactive controls on the map
// stage, plus an Elizabeth line banner and the first-visit card, before a
// single pin had been tapped. The phone map shows four and is better for it.
//
// Captain's cut: search, Filters, the drink lane, Plan, zoom and Layers. The
// city switcher stays with them, because it is the only door to another city
// and to the two answers the first-visit strip itself hands off to. Everything
// else moved into the control whose subject it shares.

const DESKTOP = { width: 1440, height: 900 };

/** Generous: this suite paints through a software rasteriser on a shared box. */
const ARRIVAL_TIMEOUT_MS = 90_000;

/**
 * The whole arrival set. A control joins this list with the commit that needs
 * it, a reason beside it, and never in silence.
 */
const ARRIVAL_CONTROLS = [
  "Search pubs",
  "Filters",
  "Drink: Pints",
  "Plan an outing",
  "London",
  "Zoom in",
  "Zoom out",
  "Layers",
];

/** The strip's own three, counted apart: it is the ask, and it goes. */
const FIRST_VISIT_STRIP_CONTROLS = 3;

async function arrivalChrome(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stage = document.querySelector(".mapStage");
    if (!stage) throw new Error("no map stage");
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        box.width > 2 &&
        box.height > 2 &&
        box.top < window.innerHeight &&
        box.bottom > 0 &&
        box.left < window.innerWidth &&
        box.right > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    return [
      ...stage.querySelectorAll(
        "button,a[href],[role=button],input[type=search],input[type=text]",
      ),
    ]
      .filter((element) => visible(element))
      // The card's own three are the ask, and the ask goes.
      .filter((element) => !element.closest(".mapArrivalCard"))
      // A cluster marker is the map's CONTENT, not its chrome. It is a button
      // because it is tappable, and there are as many of them as London has
      // clusters at this zoom.
      .filter((element) => !element.closest(".donut-cluster-marker"))
      .map((element) =>
        (
          (element as HTMLElement).innerText ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim(),
      );
  });
}

test.use({ viewport: DESKTOP });

test.describe("the desktop map's arrival chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
    });
  });

  test("is the eight controls the captain named, and nothing else", async ({ page }) => {
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapArrivalCard")).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });
    await expect
      .poll(async () => (await arrivalChrome(page)).length, {
        timeout: ARRIVAL_TIMEOUT_MS,
      })
      .toBe(ARRIVAL_CONTROLS.length);

    expect((await arrivalChrome(page)).sort()).toEqual([...ARRIVAL_CONTROLS].sort());
  });

  test("shows one banner at a time, and while the strip is up the strip is it", async ({
    page,
  }) => {
    await page.goto("/map");
    await expect(page.locator(".mapArrivalCard")).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });

    // The weather rail, the area news and the closure banner all wait.
    await expect(page.locator(".mapStage .desktopRail")).toHaveCount(0);
    await expect(page.locator(".mapStage .cityStatusBanner")).toHaveCount(0);
    await expect(page.locator(".mapStage .citySuggestBanner")).toHaveCount(0);
    await expect(page.locator(".mapStage .palSummon")).toHaveCount(0);

    expect(
      await page.locator(".mapArrivalCard button").count(),
    ).toBe(FIRST_VISIT_STRIP_CONTROLS);
  });
});

// At 1440 an open venue drawer cut the right half of the ask and its "Use my
// location" button. The ask now centres on the lane the drawer leaves.
test.describe("the desktop arrival ask beside an open venue drawer", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
    });
  });

  test("stays whole on the map lane left of the drawer", async ({ page }) => {
    await page.goto("/map");
    const card = page.locator(".mapArrivalCard");
    await expect(card).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });
    await expectMapToolbarReady(page, ARRIVAL_TIMEOUT_MS);
    await selectFirstToolbarVenue(page, "Lamb", ARRIVAL_TIMEOUT_MS);
    await expectSoleDesktopDrawer(page, "venue", ARRIVAL_TIMEOUT_MS);
    await expect(card).toBeVisible();

    await expect
      .poll(
        async () => {
          const drawerBox = (await desktopVenueDrawer(page).boundingBox())!;
          const cardBox = (await card.boundingBox())!;
          return cardBox.x >= 0 && cardBox.x + cardBox.width <= drawerBox.x + 1;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});

// AND THE WAIT HOLDS AFTER THE STRIP IS ANSWERED. UI review 17 Sep 2026,
// finding 5: dismissing the strip released THREE at once at 1440 (the location
// prompt, the closure and area-news rail, the concierge ask). The wait was
// enforced only against the strip; it is a cascade among the banners now
// (components/map/mapBannerStaging.css), so answering the one on screen releases
// exactly the next one down.
test.describe("the desktop map after the arrival strip is answered", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("still holds one ambient surface, whichever of them is eligible", async ({
    page,
  }) => {
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapArrivalCard")).toHaveCount(0);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({
      timeout: ARRIVAL_TIMEOUT_MS,
    });

    // These mount off four independent reads, so the count is watched while
    // each of them lands rather than read once at the end.
    for (let pass = 0; pass < 12; pass += 1) {
      const painted = await paintedAmbientSurfaces(page);
      expect(
        painted.length,
        `pass ${pass}: ${painted.join(", ") || "no ambient surface"}`,
      ).toBeLessThanOrEqual(1);
      await page.waitForTimeout(500);
    }
  });

  // ZOOM IN OWNS ITS OWN CENTRE AT EVERY WIDTH. UI review 17 Sep 2026, finding
  // 1: from 1024px to 1280px the button was painted, 44x44, and
  // `elementFromPoint` at its own centre answered `div.mapToolbarRow`, so the
  // click was swallowed by the toolbar. A hit test at the button's centre is the
  // assertion, not a screenshot: the button was always THERE.
  for (const width of [768, 900, 1024, 1280, 1440] as const) {
    test(`${width}px zoom controls own their own centres`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto("/map");
      expect(response?.status()).toBe(200);
      await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible({
        timeout: ARRIVAL_TIMEOUT_MS,
      });
      await expect(page.locator(".mapToolbar")).toBeVisible({
        timeout: ARRIVAL_TIMEOUT_MS,
      });

      const reading = await page.evaluate(() =>
        [".maplibregl-ctrl-zoom-in", ".maplibregl-ctrl-zoom-out"].map(
          (selector) => {
            const node = document.querySelector(selector);
            if (!node) throw new Error(`${selector} is missing`);
            const box = node.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return {
              selector,
              width: box.width,
              height: box.height,
              ownsCentre: hit === node || node.contains(hit),
              answeredBy: hit
                ? `${hit.tagName.toLowerCase()}.${String(hit.className)}`
                : "nothing",
            };
          },
        ),
      );

      for (const control of reading) {
        expect(
          control.ownsCentre,
          `${control.selector} centre answered ${control.answeredBy}`,
        ).toBe(true);
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
});
