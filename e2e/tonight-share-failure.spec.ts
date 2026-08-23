import { expect, test } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

test("mobile Tonight share failure keeps status below its action", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");

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
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);

  const share = page.locator(".tonightShare");
  await expect(share).toBeVisible();
  await share.click();

  const status = page.locator('.tonightEyebrowRow [role="status"]');
  await expect(status).toHaveText("Could not share tonight. Try again.");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator('.tonightShareAction [role="status"]')).toHaveCount(0);

  const actionBox = await share.boundingBox();
  const statusBox = await status.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(statusBox!.y, "share failure status should start below its action").toBeGreaterThanOrEqual(
    actionBox!.y + actionBox!.height,
  );
});
