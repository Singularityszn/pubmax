import { expect, test } from "@playwright/test";

import { expectHydrated, expectStreamedPageSettled } from "./helpers/streamedPage";

test.use({ isMobile: true, hasTouch: true });

test("mobile discover redirects to its selected Social tab and opens the planner", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/social\?tab=discover$/);
  await expectStreamedPageSettled(page);

  const discoverTab = page.locator(".socialSwitcher").getByRole("link", { name: "Pubs & pints", exact: true });
  await expect(discoverTab).toBeVisible();
  await expect(discoverTab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Pubs and pints", exact: true })).toBeVisible();

  const plannerCta = page
    .getByRole("region", { name: "Where you can plan a crawl tonight" })
    .locator("header")
    .getByRole("link", { name: "Open planner", exact: true });
  await expect(plannerCta).toBeVisible();
  await expectHydrated(plannerCta);
  await plannerCta.scrollIntoViewIfNeeded();
  await expect(plannerCta).toBeInViewport();

  const ctaBox = await plannerCta.boundingBox();
  expect(ctaBox, "Open planner has a tappable box").not.toBeNull();
  expect(ctaBox!.height, "Open planner touch target height").toBeGreaterThanOrEqual(44);
  expect(ctaBox!.width, "Open planner touch target width").toBeGreaterThanOrEqual(44);

  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: "Discover should not horizontally overflow at 390px" },
    )
    .toBeLessThanOrEqual(1);

  await plannerCta.tap();

  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { name: "Plan a pub crawl", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Step by step", exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: "Planner should not horizontally overflow at 390px" },
    )
    .toBeLessThanOrEqual(1);
});
