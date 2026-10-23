import { expect, test } from "@playwright/test";

import { capturePublicPageEvidence } from "./helpers/publicPageEvidence";

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
  await expect(page.locator("main time").first()).toHaveAttribute("datetime", "2026-10-22");
  await expect(page.locator("main time").first()).toHaveText("22 October 2026");
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
