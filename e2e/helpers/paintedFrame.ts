import type { Page } from "@playwright/test";

type PageScreenshotOptions = Parameters<Page["screenshot"]>[0];

/**
 * Take a page screenshot after the page has painted a frame.
 *
 * Chromium answers `Page.captureScreenshot` with "Unable to capture
 * screenshot" when the page has not produced a frame yet. A map page that
 * closes in the same browser while its WebGL shaders still compile holds the
 * next page's frames back, and `page.screenshot` does not wait for a frame
 * (only `toHaveScreenshot` does). Two animation frames prove the compositor
 * has drawn this page.
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
