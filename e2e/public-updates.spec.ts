import { expect, test } from "@playwright/test";

import { PUBLIC_UPDATES } from "@/lib/publicUpdates";

import { capturePublicPageEvidence } from "./helpers/publicPageEvidence";

// The page leads with the newest released note, so the pin follows the data
// rather than a typed date that goes stale with every new entry.
const newest = PUBLIC_UPDATES.map((update) => update.date).toSorted().at(-1)!;
const newestLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${newest}T00:00:00Z`));

test("a signed-out phone reader can open released updates from You", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/u/you");
  await expect(async () => {
    if (!/\/updates$/.test(page.url())) {
      await page.getByRole("link", { name: "Updates", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/updates$/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "What's changed", exact: true })).toBeVisible();
  await expect(page.locator("main time").first()).toHaveAttribute("datetime", newest);
  await expect(page.locator("main time").first()).toHaveText(newestLabel);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pubmaxxing.com/updates");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("updates-390.png"), fullPage: true });
  await expect(async () => {
    if (!/\/map$/.test(page.url())) {
      await page.getByRole("link", { name: "Open the map", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/map$/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});

if (process.env.PUBMAX_PUBLIC_EVIDENCE_PHASE) {
  test.use({ trace: "off", video: "off" });
  test.describe("public screenshot evidence", () => {
    test("records the signed-out updates source and viewport images", async ({ page }, testInfo) => {
      await capturePublicPageEvidence(page, testInfo, "updates");
    });
  });
}
