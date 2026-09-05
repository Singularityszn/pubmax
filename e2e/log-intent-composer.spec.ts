import { expect, test } from "@playwright/test";

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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });

  const response = await page.goto("/map?log=1");
  expect(response?.status()).toBe(200);

  // With no `sel=`, the intent offers the nearby picker; take the pub it leads
  // with, which is the ordinary path from the create action's "Log a price".
  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 20_000 });
  // A control painted on the server is tappable before React attaches, so the
  // tap is retried rather than the assertion after it made harder.
  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    await nearby.click();
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
});
