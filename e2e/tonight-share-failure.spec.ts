import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
test(`${viewport.label} Tonight share failure keeps status below its action`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => Promise.reject(new Error("share unavailable")),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("clipboard unavailable")) },
    });
  });

  const response = await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // Share sits under the listings it is about (#1575), in the credits block
  // that follows the lede region, not in the head.
  const credits = page.locator(".tonightHeadCredits");
  const share = credits.locator(".tonightShare");
  await expect(share).toBeVisible();
  const status = credits.locator('.tonightShareControl [role="status"]');
  // A server-painted button is tappable before hydration: retry the tap.
  await expect(async () => {
    await share.click();
    await expect(status).toHaveText("Could not share tonight. Try again.", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator('.tonightShareAction [role="status"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const lede = document.querySelector('[data-testid="tonight-lede"]');
      const block = document.querySelector(".tonightHeadCredits");
      return Boolean(
        lede && block && lede.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
    "Share should follow the lede region",
  ).toBe(true);

  const actionBox = await share.boundingBox();
  const statusBox = await status.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(statusBox!.y, "share failure status should start below its action").toBeGreaterThanOrEqual(
    actionBox!.y + actionBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
}
