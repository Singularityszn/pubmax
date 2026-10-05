import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "./helpers/communitySheetFixture";
import { expectLayoutSettled } from "./helpers/layoutSettled";

/**
 * F08/J33 - a blocked map still gets the reader to the venue.
 *
 * The canvas's own five failure kinds are covered by e2e/map-fallback.spec.ts
 * (no WebGL) and e2e/map-gl.spec.ts (tiles). This spec owns the two the canvas
 * cannot report, because neither leaves a canvas to report them: its module
 * never loads, and it never answers at all. Before the fix, an aborted canvas
 * chunk took the WHOLE map page to app/error.tsx - no venue list, no selected
 * pub's sheet, no Pint Drop composer.
 */

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };
const PROOF = "docs/proof/map-blocked-fallback";

const VENUE_ID = COMMUNITY_SHEET_FIXTURE_VENUE_ID;
const MISSING_VENUE_ID = "venue-does-not-exist";

function quietFirstRun(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

/**
 * The URL of the chunk that carries MapLibre, learned once per worker.
 *
 * Turbopack names chunks by content hash, so the map's chunk cannot be matched
 * by name. Learning it is one healthy visit plus a body probe, and the answer
 * is then a plain URL abort in each test: nothing else on the page is
 * intercepted, which keeps this from becoming a test of Playwright's own
 * request rewriting. The learning visit takes its OWN context and is thrown
 * away, because a page that has already loaded the chunk serves it from memory
 * on the next navigation and the abort never fires.
 */
// public/sw.js caches /_next/static in a production build and answers from
// outside Playwright's request interception, which would serve the very chunk
// this spec has to see blocked. The GL projects block it for the same reason.
base.use({ serviceWorkers: "block" });

const test = base.extend<Record<string, never>, { mapLibraryChunk: string }>({
  mapLibraryChunk: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const chunks = new Set<string>();
      page.on("response", (response) => {
        const url = response.url();
        if (/\/_next\/static\/chunks\/.*\.js/.test(url)) chunks.add(url);
      });
      await page.goto("/map");
      await expect(page.locator(".maplibreMap")).toBeVisible({ timeout: 45_000 });
      const probed = await Promise.all(
        [...chunks].map(async (url) => {
          const body = await page.request
            .get(url)
            .then((response) => response.text())
            .catch(() => "");
          return [url, body.includes("maplibregl")] as const;
        }),
      );
      const found = probed.find(([, carriesMapLibre]) => carriesMapLibre);
      expect(found, "no served chunk carries MapLibre").toBeTruthy();
      await context.close();
      await use(found![0]);
    },
    { scope: "worker" },
  ],
});

/**
 * Abort exactly that chunk, and nothing else on the page. Matching on the
 * PATHNAME keeps the abort honest across the deploy-revision query Next
 * appends, and the returned counter is asserted so a block that silently
 * stopped matching fails loudly rather than quietly testing a healthy map.
 */
async function blockMapLibrary(page: Page, chunk: string): Promise<() => number> {
  const { pathname } = new URL(chunk);
  let aborted = 0;
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      aborted += 1;
      await route.abort("failed");
    },
  );
  return () => aborted;
}

const fallback = (page: Page) => page.locator(".mapFallback");

/**
 * The class of whatever owns a control's centre point, read in ONE layout.
 * Reading the box first and hit-testing in a later call measures two layouts:
 * a city strip or venue rows landing in between move the control, and the
 * stale point then lands on the card behind it. Callers wait for the control
 * to rest first and then read once, so a real overlap is never polled away.
 */
const centreOwner = (control: Locator) =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const owner = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    return String(owner?.className ?? "none");
  });
const spilled = (page: Page) => page.getByText("Spilled.", { exact: true });

/**
 * Proof shots are for the design pass, not for every run: capturing one is a
 * CDP call that can fail under parallel load, and a spec that fails on a
 * screenshot is reporting on the harness rather than on the product. The
 * assertions above each call are what hold the behaviour.
 */
async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.PUBMAX_MAP_BLOCKED_SHOTS) return;
  await mkdir(PROOF, { recursive: true });
  await page.screenshot({ path: `${PROOF}/${name}.png` });
}

test.describe("a blocked map library keeps the pubs reachable", () => {
  for (const [label, viewport] of [
    ["390", PHONE],
    ["768", TABLET],
    ["1440", DESKTOP],
  ] as const) {
    test(`/map falls back to the venue view at ${label}`, async ({
      page,
      mapLibraryChunk,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await quietFirstRun(page);
      const aborted = await blockMapLibrary(page, mapLibraryChunk);

      await page.goto("/map");

      await expect(fallback(page)).toBeVisible({ timeout: 45_000 });
      expect(aborted(), "the map chunk was never actually blocked").toBeGreaterThan(0);
      // The whole-app error page is the defect this replaces.
      await expect(spilled(page)).toHaveCount(0);
      await expect(fallback(page)).toContainText("Map couldn't load");
      await expect(fallback(page)).toContainText("still work as ever");
      // The pubs, and a way to all of them.
      await expect
        .poll(() => page.locator(".mapFallbackVenue").count(), { timeout: 60_000 })
        .toBeGreaterThan(0);
      await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
      // One retry control, and it is tappable rather than under other chrome.
      const retry = page.locator(".mapFallbackRetry");
      await expect(retry).toBeVisible();
      await expectLayoutSettled(retry);
      expect(await centreOwner(retry)).toContain("mapFallbackRetry");
      // The heading and its one sentence are READ from below the phone chrome.
      // They used to sit behind the top bar: .mapFallback's phone padding-top
      // named a token nothing defines, so the whole calc() was dropped.
      if (viewport.width <= 640) {
        const chromeBottom = await page
          .locator(".mobileMapChrome")
          .first()
          .boundingBox()
          .then((box) => (box ? box.y + box.height : 0));
        expect(chromeBottom).toBeGreaterThan(0);
        for (const part of [
          fallback(page).locator("strong"),
          fallback(page).locator("p"),
        ]) {
          const box = await part.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.y).toBeGreaterThanOrEqual(chromeBottom);
        }
      }
      // The card owns the surface, so no ambient banner lands on its rows: at
      // 390 the UK place arrival note, at 1440 the city-conditions banner.
      await expect(page.locator(".ukPlaceArrival")).toHaveCount(0);
      await expect(page.locator(".cityStatusBanner")).toHaveCount(0);
      // The loading frame let go rather than sitting over the answer, and the
      // slot says which state the shell decided rather than leaving a test to
      // infer it from whichever card is painted.
      await expect(page.locator(".mapLoading")).toHaveCount(0);
      await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
        "data-map-canvas",
        "unavailable-module",
      );
      await shot(page, `after-library-blocked-${label}`);
    });
  }

  test("a fallback row opens the pub's own sheet at 390", async ({
    page,
    mapLibraryChunk,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);
    await blockMapLibrary(page, mapLibraryChunk);

    await page.goto("/map");
    await expect(fallback(page)).toBeVisible({ timeout: 45_000 });
    await page.locator(".mapFallbackVenue").first().click();

    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="venue"]'),
    ).toBeVisible({ timeout: 30_000 });
    await shot(page, "after-library-blocked-venue-sheet-390");
  });

  test("a deep-linked pub still opens its sheet with no map at all", async ({
    page,
    mapLibraryChunk,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);
    await blockMapLibrary(page, mapLibraryChunk);

    await page.goto(`/map?sel=${VENUE_ID}`);

    await expect(spilled(page)).toHaveCount(0);
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="venue"]'),
    ).toBeVisible({ timeout: 45_000 });
    await shot(page, "after-library-blocked-sel-390");
  });

  test("the log intent still opens the composer with no map at all", async ({
    page,
    mapLibraryChunk,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);
    await blockMapLibrary(page, mapLibraryChunk);

    await page.goto(`/map?sel=${VENUE_ID}&log=1`);

    await expect(spilled(page)).toHaveCount(0);
    // §log-drop intent resolves off the slim index and the venue sheet, and
    // neither needs a canvas.
    await expect(page.getByTestId("spill-price-step")).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, "after-library-blocked-log-390");
  });

  test("Retry re-asks for the chunk rather than replaying the rejection", async ({
    page,
    mapLibraryChunk,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);

    const chunk = mapLibraryChunk;
    let blocking = true;
    let requests = 0;
    await page.route(chunk, async (route) => {
      requests += 1;
      if (blocking) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/map");
    await expect(fallback(page)).toBeVisible({ timeout: 45_000 });
    const blockedRequests = requests;

    blocking = false;
    await page.locator(".mapFallbackRetry").click();

    // React caches a rejected lazy for ever, so a retry that reused it would
    // never touch the network again and the reader would be stuck on the card.
    await expect
      .poll(() => requests, { timeout: 45_000 })
      .toBeGreaterThan(blockedRequests);
    await expect(page.locator(".maplibreMap")).toBeVisible({ timeout: 45_000 });
    await expect(fallback(page)).toHaveCount(0);
  });
});

test.describe("a tile outage leaves a retry a thumb can reach", () => {
  test("the basemap Retry owns its own centre point at 390", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);
    // Every tile source refused. The canvas stays alive and diagnoses this
    // itself (PR 1494's lane); what is asserted here is only that the control
    // its copy names can be tapped.
    await page.route(/openfreemap|\.pbf(\?|$)|tiles\./, (route) =>
      route.abort("failed"),
    );

    await page.goto("/map");

    const notice = page.locator(".mapSoftRetry");
    await expect(notice).toBeVisible({ timeout: 60_000 });
    const retry = notice.getByRole("button", { name: "Retry" });
    // Measured before the fix: BUTTON.mobilePlanActivation, the "Describe the
    // outing" bar, owned this point and swallowed the tap.
    await expectLayoutSettled(retry);
    expect(await centreOwner(retry)).toContain("mapSoftRetryBtn");
    await shot(page, "after-tiles-blocked-390");
  });
});

test.describe("a bad venue id lands somewhere a reader can act", () => {
  test("an unknown ?sel= reads as a legible note over a live map at 390", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);

    await page.goto(`/map?sel=${MISSING_VENUE_ID}`);

    const notice = page.getByTestId("unknown-map-selection");
    await expect(notice).toBeVisible({ timeout: 45_000 });
    // Never a permanent spinner: with or without a live canvas the shell's own
    // readiness ceiling puts the frame down, so this is bounded by design.
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 40_000 });

    // The note used to paint UNSTYLED at the very top of the viewport, one
    // clipped line over the phone top bar, because its stylesheet shipped only
    // with two dynamically imported banners a bad id never mounts.
    const box = await notice.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(60);
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.width).toBeLessThan(PHONE.width);
    await shot(page, "after-bad-id-390");
  });

  test("an unknown ?sel= recovers with no map at all", async ({
    page,
    mapLibraryChunk,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quietFirstRun(page);
    await blockMapLibrary(page, mapLibraryChunk);

    await page.goto(`/map?sel=${MISSING_VENUE_ID}`);

    await expect(spilled(page)).toHaveCount(0);
    await expect(fallback(page)).toBeVisible({ timeout: 45_000 });
    // Never a permanent spinner: the frame let go and the pubs are listed.
    await expect(page.locator(".mapLoading")).toHaveCount(0);
    await expect
      .poll(() => page.locator(".mapFallbackVenue").count(), { timeout: 60_000 })
      .toBeGreaterThan(0);
    await shot(page, "after-bad-id-library-blocked-390");
  });
});
