import { expect, test } from "@playwright/test";

const CASES = [
  {
    label: "mobile landing",
    viewport: { width: 390, height: 844 },
    path: "/",
    selector: ".lpWordmark .pubmaxxWordmark",
  },
  {
    label: "desktop navigation",
    viewport: { width: 1440, height: 900 },
    path: "/map",
    selector: ".siteNavBrand .pubmaxxWordmark",
  },
] as const;

for (const view of CASES) {
  test(`${view.label} shows an uncut PUBMAXX wordmark`, async ({ page }) => {
    await page.setViewportSize(view.viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });

    const response = await page.goto(view.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const wordmark = page.locator(view.selector).first();
    await expect(wordmark).toBeVisible({ timeout: 45_000 });
    await expect(wordmark).toHaveAccessibleName("PUBMAXX");
    const box = await wordmark.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.viewport.width);
    await expect(wordmark.locator(".pubmaxxDoubleX svg")).toHaveCount(2);
  });
}
