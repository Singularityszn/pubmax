import type { Page } from "@playwright/test";

type PageScreenshotOptions = Parameters<Page["screenshot"]>[0];

/**
 * Take a page screenshot after two animation-frame callbacks.
 *
 * Chromium can reject an early `Page.captureScreenshot` with "Unable to
 * capture screenshot". Allow a rendering opportunity before capture.
 * These callbacks do not prove compositor completion or WebGL readiness.
 */
export async function capturePage(page: Page, options?: PageScreenshotOptions): Promise<Buffer> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return page.screenshot(options);
}
