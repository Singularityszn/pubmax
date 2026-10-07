import { expect, test } from "@playwright/test";

import { resolvedColour } from "./helpers/hitArea";

// Starting a crawl printed "Walking · 0/3 stops" flush against the "Check last
// train" button above it, with nothing between them.

test("the crawl progress line has its own space under the last-train button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const response = await page.goto("/map?mode=build&pubs=venue-149rmv7,venue-1vle947");
  expect(response?.status()).toBe(200);

  const pill = page.getByRole("button", { name: /stop plan/ });
  await expect(async () => {
    if (!(await page.locator(".mapDrawer .routePanel").isVisible())) await pill.first().click();
    await expect(page.locator(".mapDrawer .routePanel")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("button", { name: "Start this crawl", exact: true }).click();
  const row = page.getByTestId("crawl-progress");
  await expect(row.getByRole("status")).toContainText("stops");

  const gap = await row.evaluate((el) => {
    const previous = el.previousElementSibling;
    const status = el.querySelector(".crawlProgressStatus");
    if (!previous || !status) return null;
    return status.getBoundingClientRect().top - previous.getBoundingClientRect().bottom;
  });
  expect(gap).not.toBeNull();
  expect(gap!).toBeGreaterThanOrEqual(8);

  // The line is printed in the accent ink, not the pale gold an undefined
  // --accent fell back to.
  const ink = await row.locator(".crawlProgressStatus").evaluate((el) => getComputedStyle(el).color);
  expect(ink).toBe(await resolvedColour(page, ".mapDrawer .routePanel", "var(--brass-ink)"));
  expect(ink).not.toBe("rgb(224, 179, 74)");
});
