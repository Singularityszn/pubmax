import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
test(`${viewport.label} Tonight share failure keeps status below its action`, async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    const shareProbe = { shareCalls: 0, clipboardCalls: 0 };
    Object.defineProperty(window, "__tonightShareProbe", { value: shareProbe });
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => {
        shareProbe.shareCalls += 1;
        return Promise.reject(new Error("share unavailable"));
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          shareProbe.clipboardCalls += 1;
          return Promise.reject(new Error("clipboard unavailable"));
        },
      },
    });
  });

  const response = await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const share = page.locator(".tonightShare");
  await expect(share).toBeVisible();
  await share.click();

  const status = page.locator('.tonightShareControl [role="status"]');
  try {
    await expect(status).toHaveText("Could not share tonight. Try again.");
  } finally {
    const browserState = await page.evaluate(() => ({
      probe: (window as Window & {
        __tonightShareProbe?: { shareCalls: number; clipboardCalls: number };
      }).__tonightShareProbe ?? null,
      readyState: document.readyState,
      picksState: document.querySelector('[data-testid="tonight-screen"]')
        ?.getAttribute("data-picks-state") ?? null,
      status: document.querySelector('.tonightShareControl [role="status"]')
        ?.textContent ?? null,
    }));
    await testInfo.attach("tonight-share-diagnostics", {
      body: JSON.stringify({ ...browserState, pageErrors }, null, 2),
      contentType: "application/json",
    });
  }
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator('.tonightShareAction [role="status"]')).toHaveCount(0);

  const actionBox = await share.boundingBox();
  const statusBox = await status.boundingBox();
  const controlBox = await page.locator(".tonightShareControl").boundingBox();
  expect(actionBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(Math.abs(controlBox!.y - actionBox!.y)).toBeLessThanOrEqual(1);
  expect(statusBox!.y, "share failure status should start below its action").toBeGreaterThanOrEqual(
    actionBox!.y + actionBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
}
