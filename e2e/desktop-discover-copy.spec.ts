import { expect, test } from "@playwright/test";

import { expectHydrated, expectStreamedPageSettled } from "./helpers/streamedPage";

test("1280px keeps the Free badge outside the drink-lane arrow and edge fade", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  const response = await page.goto("/discover", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  // /discover lands on /social, which streams its loading skeleton first. On
  // a loaded box React can render that segment again on the client after the
  // swap, so a read of the server's copy meets a detached node ("Element is
  // not attached to the DOM", 5 of 40 runs under 14 workers). A hydrated link
  // is the committed copy.
  await expectStreamedPageSettled(page);

  const lowNo = page.locator(".discoverLowNoItem");
  await expect(lowNo).toBeVisible();
  await expectHydrated(lowNo.locator(".discoverLowNoLink"));
  await lowNo.scrollIntoViewIfNeeded();

  const layout = await page.locator(".discoverExplore").evaluate((showcase) => {
    const grid = showcase.querySelector<HTMLElement>(".catShowcase__grid");
    const badge = showcase.querySelector<HTMLElement>(".discoverLowNoBadge");
    const previous = showcase.querySelector<HTMLElement>(
      ".catShowcase__arrow--prev",
    );
    if (!grid || !badge || !previous) {
      throw new Error("Discover drink lane is incomplete");
    }
    const gridBox = grid.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    const previousBox = previous.getBoundingClientRect();
    const overlapWidth = Math.max(
      0,
      Math.min(badgeBox.right, previousBox.right) -
        Math.max(badgeBox.left, previousBox.left),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(badgeBox.bottom, previousBox.bottom) -
        Math.max(badgeBox.top, previousBox.top),
    );
    return {
      badgeText: badge.textContent?.trim() ?? "",
      badgeLeftInGrid: badgeBox.left - gridBox.left,
      overlapArea: overlapWidth * overlapHeight,
    };
  });

  expect(layout.badgeText).toBe("Free");
  expect(
    layout.badgeLeftInGrid,
    "badge starts beyond the 44px desktop edge fade",
  ).toBeGreaterThanOrEqual(44);
  expect(
    layout.overlapArea,
    "desktop previous-arrow never paints over the badge",
  ).toBe(0);
});
