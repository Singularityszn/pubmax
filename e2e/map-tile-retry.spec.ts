import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// A transient basemap outage is the reader's most common one and the one they
// must never be told about. MapLibre never re-asks for a tile it failed, so a
// handful of aborted tiles used to sit as a permanent hole: on a cold load,
// four of them inside the burst window spent the mount's one style reload and
// printed `[pubmap] tile failure burst, reloading style`, and a second round
// put "Map background couldn't load" over a map that was one retry from fine.
//
// The contract this spec holds (lib/mapTileFailure.ts owns the decision):
//   • aborted tiles that succeed on the next attempt reload the SOURCE alone,
//     silently: no style reload, no banner, no console warning;
//   • a style both URLs refuse still earns the honest banner.
//
// Runs under `chromium-gl`: only a real WebGL2 context builds the scene whose
// error path this is about.
const STYLE_RELOAD_WARNING = /tile failure burst, reloading style/i;
const BASEMAP_BANNER = "Map background couldn't load";

function collectPubmapWarnings(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    const text = message.text();
    if (text.includes("[pubmap]")) seen.push(text);
  });
  page.on("pageerror", (error) => seen.push(`[pubmap] pageerror ${error.message}`));
  return seen;
}

// The production build registers public/sw.js, and its tile cache answers
// basemap requests from inside the worker, where page.route() never sees them.
// Without this block the worker's own fetches reach the real tile host and fail,
// so the fixture's outage never ends. chromium-gl blocks workers for the same
// reason, and the default chromium project runs this spec too.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`/map recovers silently from a transient tile outage on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const warnings = collectPubmapWarnings(page);
    // Six aborts is past TILE_FAILURE_BURST (4), so the old classifier reached
    // its style reload on the cold load. Everything after them serves, which is
    // what a transient outage means. The delay stands in for a throttled link.
    await installDeterministicMapBasemap(page, {
      failPrimaryRasterRequests: 6,
      primaryRasterDelayMs: 120,
    });

    await page.goto("/map");
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
      timeout: 30_000,
    });
    // Past both silent retries, their backoff and the readiness ceiling, so
    // everything this spec forbids has had its chance to arrive.
    await page.waitForTimeout(16_000);

    expect(
      warnings.filter((line) => STYLE_RELOAD_WARNING.test(line)),
      `no style reload for a transient tile outage: ${warnings.join(" | ")}`,
    ).toEqual([]);
    // The captain's second symptom, held by its own words. The map's separate
    // scene-ready guard has its own copy and its own cause, and a loaded box
    // can land it inside any fixed wait; this spec does not adjudicate that
    // race, only whether a transient tile outage is ever spoken about.
    await expect(
      page.locator("body"),
      `nothing on screen about a transient outage: ${warnings.join(" | ")}`,
    ).not.toContainText(BASEMAP_BANNER);
  });
}

test("/map retries a transient production vector-source outage silently", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const warnings = collectPubmapWarnings(page);
  let failedVectorRequests = 0;
  await page.route(/tiles\.openfreemap\.org\/planet\/.*\.pbf(?:\?|$)/, async (route) => {
    if (failedVectorRequests < 6) {
      failedVectorRequests += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/map");
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => failedVectorRequests, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  await page.waitForTimeout(16_000);
  expect(
    warnings.filter((line) => STYLE_RELOAD_WARNING.test(line)),
    `no style reload for a transient vector outage: ${warnings.join(" | ")}`,
  ).toEqual([]);
  await expect(page.locator("body")).not.toContainText(BASEMAP_BANNER);
});

test("/map still says so when both style URLs refuse", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeterministicMapBasemap(page, { failStyle: true });

  await page.goto("/map");
  // No style ever loaded, so the honest surface is the full card rather than
  // the toast (`basemapFailureSurface`), and no silent source retry can help:
  // there is no source to re-ask.
  await expect(page.locator(".mapFallback")).toContainText(
    "The map couldn't load its tiles right now",
    { timeout: 45_000 },
  );
});

test("/map still shows the banner when tiles never come back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const warnings = collectPubmapWarnings(page);
  // The genuine failure: the style loads, and every tile request refuses for
  // good. The silent lane spends its two attempts, the mount spends its one
  // style reload, and only then is the reader told.
  await installDeterministicMapBasemap(page, {
    failPrimaryRasterRequests: Number.MAX_SAFE_INTEGER,
  });

  await page.goto("/map");
  // WHICH honest surface lands is a race this spec deliberately does not pick:
  // the map's own scene-ready guard has its own card on a slow box, and both
  // it and the tile toast tell the reader the truth. What must hold is that
  // the reader IS told, and that the style reload the silent lane defers was
  // still spent on a failure that never recovered.
  await expect(page.locator(".mapSoftRetry, .mapFallback").first()).toContainText(
    new RegExp(`${BASEMAP_BANNER}|couldn't load its tiles|taking too long`),
    { timeout: 60_000 },
  );
  await expect
    .poll(() => warnings.some((line) => STYLE_RELOAD_WARNING.test(line)), {
      timeout: 30_000,
      message: "the style reload is kept for a real outage",
    })
    .toBe(true);
});
