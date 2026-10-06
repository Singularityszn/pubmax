import { expect, test } from "@playwright/test";

// The planner rail's search box was a bare input inside a label that held only
// an icon, so it had no accessible name. The featured-route buttons repeated
// "crawl" for any route already named one ("Borough Market crawl crawl").

test("the rail search box and featured routes have clean accessible names", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/map?plan=1");

  await expect(page.getByRole("textbox", { name: "Search pubs and areas" })).toBeVisible();

  await expect(page.locator(".featuredCrawl").first()).toHaveAttribute("aria-label", /^Map /);
  const labels = await page
    .locator(".featuredCrawl")
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label).toMatch(/^Map .+ with \d+ stops?$/);
    expect(label).not.toMatch(/crawl crawl/i);
  }
});
