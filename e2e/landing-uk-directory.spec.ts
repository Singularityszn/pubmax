import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { UI_UX_CHROMIUM_ARGS } from "../scripts/lib/uiUxBattleTestBrowser.mjs";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectLayoutSettled } from "./helpers/layoutSettled";

test.use({ launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] } });

type NationalMapWindow = Window & {
  __pubmaxMapCamera?: {
    read: () => {
      center: [number, number];
      zoom: number;
      moving: boolean;
      settling: boolean;
    };
  };
  __pubmaxPaintedMapTapPoints?: {
    state?: () => { loaded: boolean; styleLoaded: boolean | null; tilesLoaded: boolean | null };
  };
};

type NationalCamera = { center: [number, number]; zoom: number };

/** Independent Web Mercator geometry for the agreed UK bounds, in CSS pixels. */
function boundedNationalCamera(width: number, height: number): NationalCamera {
  // These are the agreed geographic contract, not values read from the camera.
  const requested = { longitude: -2.5, latitude: 54.2, zoom: 5.6 };
  const uk = { west: -8.7, east: 1.9, south: 49.8, north: 61 };
  const worldSize = 512 * 2 ** requested.zoom;
  const x = (longitude: number) => (longitude + 180) / 360 * worldSize;
  const y = (latitude: number) => {
    const radians = latitude * Math.PI / 180;
    return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2 * worldSize;
  };
  const left = x(uk.west), right = x(uk.east);
  const top = y(uk.north), bottom = y(uk.south);
  const widen = width > right - left;
  const heighten = height > bottom - top;
  const scale = Math.max(1, width / (right - left), height / (bottom - top));
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

  // A viewport wider/taller than the bounded world must zoom in and centre on
  // that bounded axis. Otherwise the requested centre only needs edge clamping.
  const centerX = scale > 1
    ? (widen ? (left + right) / 2 : x(requested.longitude))
    : clamp(x(requested.longitude), left + width / 2, right - width / 2);
  const centerY = scale > 1
    ? (heighten ? (top + bottom) / 2 : y(requested.latitude))
    : clamp(y(requested.latitude), top + height / 2, bottom - height / 2);
  return {
    center: [
      centerX / worldSize * 360 - 180,
      Math.atan(Math.sinh(Math.PI * (1 - 2 * centerY / worldSize))) * 180 / Math.PI,
    ],
    zoom: requested.zoom + Math.log2(scale),
  };
}

async function expectPaintedNationalOverview(
  page: Page, testInfo: TestInfo, pendingCountryRequests: Set<string>,
): Promise<NationalCamera> {
  let expected: NationalCamera | undefined;
  try {
    const wrap = page.locator(".mapCanvasWrap");
    await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required", { timeout: 45_000 });
    await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
    const viewport = await page.locator(".maplibreMap").evaluate((node) => ({
      width: node.clientWidth, height: node.clientHeight,
    }));
    expect(viewport.width).toBeGreaterThan(0);
    expect(viewport.height).toBeGreaterThan(0);
    const bounded = boundedNationalCamera(viewport.width, viewport.height);
    expected = bounded;

    // Three consecutive rendered frames must have complete tiles and a rested
    // camera at the UK overview, rather than a London camera or loading frame.
    await expect.poll(async () => page.evaluate(async (bounded) => {
      const target = window as NationalMapWindow;
      for (let frame = 0; frame < 3; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const camera = target.__pubmaxMapCamera?.read();
        const paint = target.__pubmaxPaintedMapTapPoints?.state?.();
        if (
          !camera || camera.moving || camera.settling ||
          Math.abs(camera.center[0] - bounded.center[0]) > 0.05 ||
          Math.abs(camera.center[1] - bounded.center[1]) > 0.05 ||
          Math.abs(camera.zoom - bounded.zoom) > 0.05 ||
          !paint?.loaded || !paint.styleLoaded || !paint.tilesLoaded
        ) return false;
      }
      return true;
    }, bounded), { timeout: 45_000, message: "the clicked UK map paints and rests at the national overview" }).toBe(true);
    await expectMapLoadingFrameReleased(page);
    await expect(page.locator(".mapFallback")).toHaveCount(0);
    return bounded;
  } catch (error) {
    try {
      const lastActual = await page.evaluate((expected) => {
        const target = window as NationalMapWindow;
        const bounds = (node: Element | null) => node?.getBoundingClientRect().toJSON() ?? null;
        const elements = (selector: string) => Array.from(document.querySelectorAll(selector), (node) => {
          const style = getComputedStyle(node);
          return { bounds: bounds(node), display: style.display, visibility: style.visibility, opacity: style.opacity };
        });
        const wrap = document.querySelector(".mapCanvasWrap");
        const canvas = document.querySelector<HTMLCanvasElement>(".maplibreMap canvas");
        const camera = target.__pubmaxMapCamera?.read() ?? null;
        const paint = target.__pubmaxPaintedMapTapPoints?.state?.() ?? null;
        return {
          expected, camera, paint,
          conditions: {
            cameraPresent: Boolean(camera),
            cameraRested: Boolean(camera && !camera.moving && !camera.settling),
            nationalLongitude: Boolean(camera && expected && Math.abs(camera.center[0] - expected.center[0]) <= 0.05),
            nationalLatitude: Boolean(camera && expected && Math.abs(camera.center[1] - expected.center[1]) <= 0.05),
            nationalZoom: Boolean(camera && expected && Math.abs(camera.zoom - expected.zoom) <= 0.05),
            loaded: paint?.loaded ?? null,
            styleLoaded: paint?.styleLoaded ?? null,
            tilesLoaded: paint?.tilesLoaded ?? null,
          },
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          geometry: {
            wrap: bounds(wrap), container: bounds(document.querySelector(".maplibreMap")),
            canvas: bounds(canvas), canvasWidth: canvas?.width ?? null, canvasHeight: canvas?.height ?? null,
          },
          loading: elements(".mapLoading"), fallback: elements(".mapFallback"),
          country: {
            status: wrap?.getAttribute("data-uk-base-status") ?? null,
            count: wrap?.getAttribute("data-uk-base-count") ?? null,
            venueIndex: wrap?.getAttribute("data-venue-index") ?? null,
          },
        };
      }, expected);
      await testInfo.attach("national-overview-failure-state", {
        body: JSON.stringify({ ...lastActual, pendingCountryRequests: [...pendingCountryRequests] }, null, 2),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath("uk-map-failure.png") });
    } catch (diagnosticError) {
      await testInfo.attach("national-overview-diagnostic-error", {
        body: String(diagnosticError), contentType: "text/plain",
      });
    }
    throw error;
  }
}

// Compare the rendered homepage with the public pack, rather than importing
// the production count helper as the expected answer.
test.describe("clicked UK directory arrivals", () => {
  test.use({ serviceWorkers: "block" });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`UK directory entry reaches the national map at ${viewport.width} ${theme}`, async ({
        page,
        request,
      }, testInfo) => {
        test.setTimeout(90_000);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((selectedTheme) => {
          window.localStorage.setItem("pubmax-theme", selectedTheme);
          window.localStorage.setItem("pubmax-tour-v1-done", "1");
          window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
          window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
          window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
        }, theme);

        const manifestResponse = await request.get("/data/uk_base/manifest.json");
        expect(manifestResponse.ok()).toBe(true);
        const { generatedFrom } = await manifestResponse.json();
        expect(generatedFrom.pubs).toBeGreaterThan(0);
        expect(generatedFrom.pubs + generatedFrom.unnamed + generatedFrom.bars)
          .toBe(generatedFrom.count);

        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const coverage = page.locator("[data-uk-coverage]");
        await expect(coverage).toContainText(
          `${(generatedFrom.pubs + generatedFrom.unnamed).toLocaleString("en-GB")} UK pub listings`,
        );
        await expect(coverage).toContainText(
          `${generatedFrom.bars.toLocaleString("en-GB")} bar listings from OpenStreetMap`,
        );
        await expect(coverage).toContainText("A listing doesn't mean we have its prices or know it's open.");

        // The UK catalogue cannot replace the smaller priced London cohort.
        const londonSample = page.locator(".lpWorth .lpSavingSummary")
          .filter({ hasText: /pubs in our London pub list with a listed price/ });
        await expect(londonSample).toHaveCount(1);
        await expect(londonSample).toContainText(/cheapest listed pint across [\d,]+ pubs in our London pub list with a listed price/);

        const entry = page.getByRole("link", { name: "Browse pubs across the UK", exact: true });
        await expect(entry).toHaveAttribute("href", "/map?uk=1");
        await entry.scrollIntoViewIfNeeded();
        await expect(coverage).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("uk-directory.png") });

        const ukRequests: string[] = [];
        const pendingCountryRequests = new Set<string>();
        page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (path.startsWith("/data/uk_base/")) {
            ukRequests.push(path);
            pendingCountryRequests.add(request.url());
          }
        });
        page.on("requestfinished", (request) => pendingCountryRequests.delete(request.url()));
        page.on("requestfailed", (request) => pendingCountryRequests.delete(request.url()));
        await entry.click();
        await expect(page).toHaveURL(/\/map\?uk=1$/);
        const ukNote = page.getByRole("complementary", { name: "UK pub map", exact: true });
        await expect(ukNote).toBeVisible({ timeout: 45_000 });
        await expect(ukNote).toContainText("Zoom in to load pubs on the map.");
        const expected = await expectPaintedNationalOverview(page, testInfo, pendingCountryRequests);
        const readiness = await page.evaluate(() => {
          const target = window as NationalMapWindow;
          return {
            camera: target.__pubmaxMapCamera?.read(),
            paint: target.__pubmaxPaintedMapTapPoints?.state?.(),
          };
        });
        await testInfo.attach("national-overview-readiness", {
          body: JSON.stringify({ expected, ...readiness }, null, 2),
          contentType: "application/json",
        });
        // The gazetteer may load, but the country manifest and cells stay absent
        // below the pub zoom gate, including after this clicked arrival settles.
        expect(ukRequests.filter((path) => !path.endsWith("places.json"))).toEqual([]);
        if (viewport.width === 320) {
          const peek = page.locator(".mapPeek");
          await expectLayoutSettled(ukNote);
          await expectLayoutSettled(peek);
          const geometry = await ukNote.evaluate((element) => {
            const body = element.querySelector(".ukPlaceArrivalCopy > span");
            const card = document.querySelector(".mapPeek");
            if (!body || !card) throw new Error("National note body or peek card missing");
            const range = document.createRange();
            range.selectNodeContents(body);
            const cardRect = card.getBoundingClientRect();
            return {
              note: element.getBoundingClientRect().toJSON(), peek: cardRect.toJSON(),
              lines: [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
                ...rect.toJSON(),
                uncovered: body.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
                overlapsPeek: rect.left < cardRect.right && rect.right > cardRect.left
                  && rect.top < cardRect.bottom && rect.bottom > cardRect.top,
                inViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
              })),
            };
          });
          await testInfo.attach("clicked-national-note-geometry", {
            body: JSON.stringify(geometry, null, 2), contentType: "application/json",
          });
          expect(geometry.lines.length).toBeGreaterThan(0);
          expect(geometry.lines.every(line => line.inViewport && line.uncovered && !line.overlapsPeek),
            "every line of national coverage copy remains visible above the map card").toBe(true);
        }
        if (viewport.width <= 640) {
          const credit = page.locator(".maplibregl-ctrl-attrib");
          const creditButton = credit.locator(".maplibregl-ctrl-attrib-button");
          await expect(creditButton).toBeVisible();
          for (const expanded of [false, true, false]) {
            if (expanded) {
              await creditButton.click();
              await expect(credit).toHaveClass(/maplibregl-compact-show/);
            } else if (await credit.evaluate((element) => element.classList.contains("maplibregl-compact-show"))) {
              await creditButton.click();
              await expect(credit).not.toHaveClass(/maplibregl-compact-show/);
            }
            await expectLayoutSettled(credit);
            await expectLayoutSettled(ukNote);
            const geometry = await ukNote.evaluate((element) => {
              const credit = document.querySelector(".maplibregl-ctrl-attrib");
              const button = credit?.querySelector(".maplibregl-ctrl-attrib-button");
              if (!credit || !button) throw new Error("Map credit control missing");
              const noteRect = element.getBoundingClientRect();
              const creditRect = credit.getBoundingClientRect();
              const buttonRect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
              return {
                note: noteRect.toJSON(), credit: creditRect.toJSON(),
                separate: noteRect.bottom <= creditRect.top || noteRect.top >= creditRect.bottom
                  || noteRect.right <= creditRect.left || noteRect.left >= creditRect.right,
                buttonReachable: button.contains(hit),
                noteInViewport: noteRect.top >= 0 && noteRect.bottom <= innerHeight,
              };
            });
            await testInfo.attach(`national-note-credit-${expanded ? "open" : "closed"}`, {
              body: JSON.stringify(geometry, null, 2), contentType: "application/json",
            });
            expect(geometry.separate, `coverage note does not cover the map credit: ${JSON.stringify(geometry)}`).toBe(true);
            expect(geometry.buttonReachable, `the credit button owns its centre tap: ${JSON.stringify(geometry)}`).toBe(true);
            expect(geometry.noteInViewport, `coverage note stays in view: ${JSON.stringify(geometry)}`).toBe(true);
          }
          await expect(ukNote).toBeVisible();
        }
        await page.screenshot({ path: testInfo.outputPath("uk-map-arrival.png") });
      });
    }
  }
});

test("About separates the UK directory from price coverage", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/about");
  const disclosure = page.getByText("Sources, confirmation and coverage", { exact: true });
  await disclosure.click();
  const coverage = page.getByRole("listitem").filter({ hasText: "Coverage varies by city." });
  await expect(coverage).toContainText(/UK directory has [\d,]+ pub listings and [\d,]+ bar listings from OpenStreetMap/);
  await expect(coverage).toContainText("A listing doesn’t mean we have its prices or know it’s open.");
  await expect(coverage.getByRole("link", { name: "Browse pubs across the UK", exact: true }))
    .toHaveAttribute("href", "/map?uk=1");
});
