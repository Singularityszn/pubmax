import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

/**
 * GAP 18 (mobile store-readiness audit, 2026-09-04, 390x844).
 *
 * `/map?log=1` is the working entry to the core loop. The venue sheet opened
 * with the Pint Drop composer's price step starting at y=696 in an 844px
 * viewport and running 237px tall, so the price field sat on the bottom edge
 * and "Log it" was off screen behind the sheet's own action bar. The reader had
 * expressed exactly one intent and then had to scroll to act on it.
 *
 * What is asserted is the reveal and nothing more: the price step is IN the
 * viewport once the composer is up. The sheet still renders what it rendered,
 * and focus is deliberately not moved, so no keyboard is raised here.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

test("the log intent lands the reader on the composer's price step", async ({ page }) => {
  // The picker waits on the venue index and the composer on the sheet, and
  // both are load-bound on a fleet box: the second repeat of a two-repeat run
  // at load 50 spent 20s reaching the picker and ran out of the default 30s
  // test budget on the way to the composer. The waits below have to fit in
  // the test's own budget, so the test says it is slow.
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  // The basemap is the house fixture, not the live tile host (#1489). The
  // nearby picker is a blurred sheet standing over the map for the whole of
  // the load, and under SwiftShader every one of the hundred-odd frames the
  // live tiles paint beneath it is composited in software through that blur:
  // measured on a production build, the picker arrived at 65 to 80 seconds
  // with live tiles and at 11 to 17 with this fixture, and with the blur
  // stripped it arrived at 11 either way. Nothing asserted here is about the
  // basemap, and the map's own tile specs keep the live host.
  await installDeterministicMapBasemap(page);

  const response = await page.goto("/map?log=1");
  expect(response?.status()).toBe(200);

  // With no `sel=`, the intent offers the nearby picker; take the pub it leads
  // with, which is the ordinary path from the create action's "Log a price".
  // The picker needs the viewport's shards and the venue index before it can
  // name a pub, and that wait is load-bound: 11 to 17 seconds on a quiet box,
  // past 20 under a fleet build. The budget below is a wait for the index,
  // never a geometry ceiling; the reveal's own ceilings further down stay
  // exactly where GAP 18 put them.
  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 45_000 });
  // A control painted on the server is tappable before React attaches, so the
  // tap is retried rather than the assertion after it made harder. Only a tap
  // that was dropped is retried: a tap that landed closes the picker, and on a
  // loaded box the composer can take over 10s to follow it. Clicking the gone
  // button then waited out the whole budget on actionability and never looked
  // at the price step again, which read as a composer that never opened.
  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });

  await expect
    .poll(
      async () =>
        priceStep.evaluate((step) => Math.round(step.getBoundingClientRect().top)),
      { timeout: 15_000 },
    )
    .toBeLessThan(422);

  const placement = await priceStep.evaluate((step) => {
    const rect = step.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportHeight: window.innerHeight,
    };
  });

  expect(placement.top, "the price step starts inside the viewport").toBeGreaterThanOrEqual(0);
  expect(
    placement.top,
    "the price step is not parked on the bottom edge, where it shipped",
  ).toBeLessThan(placement.viewportHeight / 2);

  // The price field itself is what the reader came to fill in.
  await expect(priceStep.locator("input").first()).toBeInViewport();

  // A reveal and never a re-layout: the sheet opened on its Pints tab, and
  // focus stayed put, so raising the keyboard is the reader's own next move.
  await expect(page.locator("#venueTab-pints")).toHaveAttribute("aria-selected", "true");
  expect(
    await priceStep.evaluate((step) => step.contains(document.activeElement)),
    "the reveal moves no focus into the price step",
  ).toBe(false);
});
