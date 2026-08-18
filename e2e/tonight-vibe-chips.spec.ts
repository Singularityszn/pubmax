import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SHOTS_DIR = "docs/screenshots/tonight-vibe-chips";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

for (const [label, width] of [
  ["390", 390],
  ["1280", 1280],
] as const) {
  test(`tonight vibe chips use sentence case @${label}`, async ({ page }) => {
    test.setTimeout(60_000);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });

    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    const vibe = page.locator(".vibeChip").first();
    await expect(vibe).toBeVisible({ timeout: 30_000 });

    const transform = await vibe.evaluate((el) => getComputedStyle(el).textTransform);
    expect(transform).not.toBe("uppercase");

    await page.screenshot({
      path: `${SHOTS_DIR}/tonight-vibe-${label}.png`,
      fullPage: false,
    });
  });
}
