import { expect, test, type Page } from "@playwright/test";

import { NIGHT_AREAS } from "@/lib/nightAreas";

const MOBILE = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
}

test("mobile Discover shows Night Area evidence states without promising routes", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const coverage = page.locator(".nightAreaCoverage");
  await expect(coverage).toBeVisible();
  await expect(coverage.getByRole("heading", { name: "Where you can plan a crawl tonight" })).toBeVisible();
  await expect(coverage.locator("header").getByRole("link", { name: "Open planner", exact: true })).toHaveAttribute("href", "/plan");
  // No area has a review, so no row may promise a crawl route.
  await expect(coverage.locator('[data-route-ready="true"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const representative = coverage.getByRole("list", { name: "Representative area coverage" });
  const browseLink = representative.getByRole("link", { name: /See the pubs in .* on the map/ }).first();
  await expect(browseLink).toHaveAttribute("href", /\/map\?q=/);
  const browseBox = await browseLink.boundingBox();
  expect(browseBox?.height ?? 0, "area action should be thumb-safe").toBeGreaterThanOrEqual(44);

  const details = coverage.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details).toContainText("Area reviews are unavailable. You can browse pubs or make a draft.");
  const rows = details.getByRole("list", { name: "All area coverage" }).getByRole("listitem");
  await expect(rows).toHaveCount(NIGHT_AREAS.length);
  await expect(rows.and(page.locator(':not([data-coverage-status="discovered"])'))).toHaveCount(0);
  await expect(details.getByRole("link", { name: /See the pubs in .* on the map/ })).toHaveCount(NIGHT_AREAS.length);
  await expectNoHorizontalOverflow(page);
});
