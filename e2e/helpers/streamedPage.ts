import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Wait until a document load has finished streaming in.
 *
 * A route with a `loading.tsx` streams its skeleton (`.routeLoadingShell`)
 * first. React then streams the real page into a hidden `<div hidden
 * id="S:…">` and swaps it in later. React 19.3 batches that swap on a timer
 * up to 300 ms after the last one, so it can land after `load`. Until then
 * the document holds two copies of the chrome: the skeleton's site nav and
 * tab bar, and the page's own in the hidden segment. When a sync update
 * makes React render the page on the client, the hidden segment stays beside
 * the live page for the same window. A DOM read in that window counts
 * every landmark, tab bar and test id twice.
 */
export async function expectStreamedPageSettled(
  page: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  await expect(page.locator(".routeLoadingShell")).toHaveCount(0, options);
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0, options);
}

/**
 * Wait until React has hydrated a control the server painted.
 *
 * A server-painted button is in the document, visible and enabled before
 * React attaches its handler, so Playwright's actionability check passes and
 * a click in that window is dropped. React stores a hydrated element's props
 * under a `__reactProps$` key on the node itself, so this waits for the one
 * thing the tap needs.
 */
export async function expectHydrated(control: Locator): Promise<void> {
  await expect
    .poll(() =>
      control.evaluate((node) =>
        Object.keys(node).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}
