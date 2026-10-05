import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared seams for the production smoke suite. Nothing here doubles the
 * network: these only put a browser into the state a returning visitor's
 * browser is already in, and record what the run saw.
 */

/**
 * Overlays a returning visitor has already dismissed. Each key is read in
 * source: the consent banner (lib/analyticsIdentity.ts), the first-run tour
 * (lib/firstRunTour.ts), the map's first-visit card (lib/mapFirstVisitArrival.ts),
 * the city suggestion, and the identity nudge that follows a plan action
 * (lib/identityNudge.ts). Leaving them up would test the overlays, not the
 * journeys behind them, and the main suite already covers each one.
 */
export async function asReturningVisitor(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
}

/**
 * Uncaught page exceptions fail the journey that raised them. Console noise
 * from third parties is not asserted on: production carries analytics and map
 * tiles whose warnings the app does not own.
 */
export function watchPageErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "uncaught page exceptions").toEqual([]);
}

/** Wait until the map has painted at least one tappable pin or cluster. */
export async function expectPaintedPins(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = (window as unknown as {
            __pubmaxPaintedMapTapPoints?: () => unknown[];
          }).__pubmaxPaintedMapTapPoints;
          return typeof probe === "function" ? probe().length : 0;
        }),
      { message: "painted map pins", timeout: 90_000, intervals: [1_000] },
    )
    .toBeGreaterThan(0);
}

/** A viewport shot kept as evidence of what production showed. */
export async function evidence(page: Page, name: string): Promise<void> {
  const testInfo = test.info();
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}
