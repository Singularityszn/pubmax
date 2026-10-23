import { expect, test } from "@playwright/test";
import { parsePosthogIngest, type IngestEvent } from "./helpers/posthogIngest";

test.use({ storageState: { cookies: [], origins: [] } });

test("consented page visits retain route engagement and the final page exit", async ({ page }) => {
  const events: IngestEvent[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/ingest/") && request.method() === "POST") {
      events.push(...parsePosthogIngest(request));
    }
  });
  await page.route("**/ingest/**", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: { status: 1 } });
    else await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
    localStorage.setItem("pubmaxx:analytics-id:v1", "anon_0123456789abcdef");
  });
  await page.goto("/privacy");
  const views = () => events.filter(({ event }) => event === "$pageview");
  await expect.poll(() => views().length, { timeout: 20_000 }).toBe(1);
  await page.evaluate(() => history.pushState(null, "", "/terms"));
  await expect.poll(() => views().length).toBe(2);
  expect(views()[1].properties).toMatchObject({
    $pathname: "/terms",
    $prev_pageview_pathname: "/privacy",
    $prev_pageview_id: views()[0].properties.$pageview_id,
    $prev_pageview_duration: expect.any(Number),
    $prev_pageview_max_content_percentage: expect.any(Number),
  });
  // Keep the document alive while Playwright intercepts the unload beacon.
  // Chromium can discard a paused request when its document is destroyed.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  const exits = () => events.filter(({ event }) => event === "$pageleave");
  await expect.poll(() => exits().length).toBe(1);
  expect(exits()[0].properties).toMatchObject({
    $pathname: "/terms",
    $prev_pageview_pathname: "/terms",
    $prev_pageview_id: views()[1].properties.$pageview_id,
    $prev_pageview_duration: expect.any(Number),
    $prev_pageview_max_content_percentage: expect.any(Number),
  });
  expect(exits()[0].properties.$prev_pageview_duration).toBeGreaterThanOrEqual(0);
  expect(exits()[0].properties.$prev_pageview_max_content_percentage).toBeGreaterThanOrEqual(0);
  expect(exits()[0].properties.$prev_pageview_max_content_percentage).toBeLessThanOrEqual(1);
});
