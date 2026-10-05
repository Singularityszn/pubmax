import { expect, test } from "@playwright/test";

import { expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

/**
 * The log-a-price drawer at 1280x900 (`/map?sel=venue-eltcmh&log=1`).
 *
 * Two layout defects shipped together on the docked desktop drawer:
 *
 * 1. The Pints tab grids its two children side by side from 1024px, and the
 *    drawer is at most 640px wide, so the open composer got about 240px: the
 *    price chips wrapped and the empty Pint Drops note sat alone in the right
 *    column.
 * 2. The log intent reveals the price step at the scrollport's top, and the
 *    drawer's sticky head (Back and close, only part opaque) stands over that
 *    edge, so "What did it cost?" landed under the Back chevron with the tab
 *    strip showing faintly through the head.
 *
 * What is asserted is geometry: the composer spans the panel, the Pint Drops
 * list stacks below it, and the composer card's top edge and price label sit
 * below the head once the reveal has run.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 1280, height: 900 },
});

test("the desktop log drawer gives the composer the full panel, clear of the head", async ({
  page,
}) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await installDeterministicMapBasemap(page);

  const response = await page.goto("/map?sel=venue-eltcmh&log=1");
  expect(response?.status()).toBe(200);

  const priceStep = page.getByTestId("spill-price-step");
  await expect(priceStep).toBeVisible({ timeout: 45_000 });
  // The venue drawer is the one open desktop drawer before anything reads it.
  await expectSoleDesktopDrawer(page, "venue");

  // The reveal waits for the composer to mount and then scrolls once. Wait until the
  // drawer's scroll position holds still across two reads before measuring.
  let lastScrollTop = -1;
  await expect
    .poll(
      async () => {
        const scrollTop = await page
          .locator(".mapDrawer.right.open")
          .evaluate((drawer) => Math.round(drawer.scrollTop));
        const settled = scrollTop > 0 && scrollTop === lastScrollTop;
        lastScrollTop = scrollTop;
        return settled;
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toBe(true);

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width };
    };
    return {
      columns: box(".venuePintsCols"),
      composer: box(".dropComposer"),
      drops: box(".venuePintsCols .pintDrops"),
      head: box(".mapDrawer.right.open .mapDrawerHead"),
      label: box(".priceFieldLabel"),
    };
  });

  expect(
    Math.abs(geometry.composer.width - geometry.columns.width),
    "the open composer spans the Pints panel instead of one grid column",
  ).toBeLessThanOrEqual(1);
  expect(
    geometry.drops.top,
    "the Pint Drops list stacks below the composer, not beside it",
  ).toBeGreaterThanOrEqual(geometry.composer.bottom);
  expect(
    geometry.composer.top,
    "the composer card's own top edge, eyebrow and pub name land below the sticky head",
  ).toBeGreaterThanOrEqual(geometry.head.bottom);
  expect(
    geometry.label.top,
    '"What did it cost?" lands below the sticky head, clear of the Back chevron',
  ).toBeGreaterThanOrEqual(geometry.head.bottom);
});
