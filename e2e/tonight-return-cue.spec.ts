import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_MAP_PATH,
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { desktopVenueDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";
import { expectMobileMapShellReady } from "./helpers/mobileMapShell";

// A returning reader with a save in this browser gets one quiet way back to it,
// after tonight's answer. A reader with nothing saved, or saves the browser
// cannot read, sees no cue at all.

const STORAGE_KEY = "pubmax:savedPubs:v1";
// Marks this tab as already seeded. sessionStorage survives Back and reload in
// the same tab, so the saves are written once and every later document reads
// whatever the app left there rather than a fresh copy of the seed.
const SEEDED_MARKER = "pubmax:e2e:tonight-return-cue-seeded";
const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const SAVED_RAW = JSON.stringify([
  {
    venueId: COMMUNITY_SHEET_FIXTURE_VENUE_ID,
    listType: "Private list label",
    note: "Private note text",
    savedAt: "2026-10-01T20:00:00.000Z",
  },
]);

// The theme is the reader's stored choice, the key public/theme-init.js reads
// before paint (the e2e/screenshots.spec.ts setTheme idiom). It is not the
// saves, so it is written on every document like the overlay keys.
async function seed(page: Page, raw: string | null, theme?: Theme): Promise<void> {
  await page.addInitScript(
    ({ key, value, marker, theme }) => {
      if (theme) window.localStorage.setItem("pubmax-theme", theme);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
      // Arm the pin-reveal trace on every document, before the cue's client
      // navigation reaches /map, so waitForLoadedMap can see the lifecycle.
      const revealWindow = window as typeof window & {
        __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
      };
      if (!revealWindow.__pubmaxPinRevealTrace) {
        const trace: Array<{ reason: string; generation: number }> = [];
        revealWindow.__pubmaxPinRevealTrace = trace;
        window.addEventListener("pubmax:pin-reveal", (event) => {
          trace.push((event as CustomEvent<{ reason: string; generation: number }>).detail);
        });
      }
      if (window.sessionStorage.getItem(marker) === "1") return;
      window.sessionStorage.setItem(marker, "1");
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: raw, marker: SEEDED_MARKER, theme: theme ?? null },
  );
}

// The theme the app actually rendered: the attribute the pre-paint script set
// and the color-scheme app/theme.css computes from it.
async function expectTheme(page: Page, theme: Theme): Promise<void> {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", theme);
  await expect
    .poll(() => html.evaluate((node) => getComputedStyle(node).colorScheme))
    .toBe(theme);
}

type PaintedMapTapPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
};

/** Count pub marks the map is painting right now (pins + clusters). */
async function paintedMapMarkCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => PaintedMapTapPoint[];
      }
    ).__pubmaxPaintedMapTapPoints;
    return probe?.().length ?? 0;
  });
}

async function pinRevealCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
        }
      ).__pubmaxPinRevealTrace?.length ?? 0,
  );
}

/** The reason on the newest pin-reveal, or null before the first one. */
async function latestPinRevealReason(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const trace = (
      window as typeof window & {
        __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
      }
    ).__pubmaxPinRevealTrace;
    return trace && trace.length > 0 ? trace[trace.length - 1]!.reason : null;
  });
}

// The map has RENDERED, read without asking whether a pointer could reach it.
//
// The painted-pin probe answers only marks a tap would land on (its third gate
// in components/map/canvas/paintedPinProbe.ts drops a mark under any app
// chrome), so with the selected pub's sheet or drawer and its backdrop up it
// may answer none over a fully painted map. These signals are the product's
// own and none of them reads pointer reachability:
//   - the live canvas wrap (PubMapCanvas's, the one carrying data-route-stops)
//     is visible and has venues handed to it, and no loading, failing or
//     unavailable wrap (those carry data-map-canvas) is left;
//   - the newest pin-reveal names a painted gate ("tiles", "pins" or "idle"),
//     which pinRevealCoordinator.ts sends only after its basemap-painted and
//     pins-paintable checks pass, and on a phone its composite-frame wait;
//     "timeout" is its ceiling lapsing and keeps this gate red;
//   - no loading shell, no fallback, and a visible GL canvas with a real size.
async function expectRenderedMap(page: Page): Promise<void> {
  const liveWrap = page.locator(".mapCanvasWrap[data-route-stops]");
  await expect(liveWrap).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mapCanvasWrap[data-map-canvas]")).toHaveCount(0);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect
    .poll(() => liveWrap.evaluate((node) => Number(node.getAttribute("data-venue-count"))), {
      message: "map render gate requires venues handed to the live canvas",
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => pinRevealCount(page), {
      message: "map visual gate requires the pin-reveal lifecycle",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => latestPinRevealReason(page), {
      message: "map render gate requires a painted pin-reveal, not the ceiling's timeout",
      timeout: 60_000,
    })
    .toMatch(/^(tiles|pins|idle)$/);
  await expect(page.locator(".mapLoading")).toHaveCount(0);
  await expect(page.getByText("Loading London pubs")).toHaveCount(0);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  const canvas = page.locator(".maplibreMap canvas, .maplibregl-canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box && box.width > 0 && box.height > 0).toBe(true);
}

// Read-only context for the selected state, attached and never asserted: how
// many marks the tap probe can reach, and what sits on top at the canvas's
// centre. It records why the tap probe can answer none under the selected
// pub's surface; it is not a readiness signal.
async function attachHitContext(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const context = await page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string }>;
      }
    ).__pubmaxPaintedMapTapPoints;
    const canvas = document.querySelector(".maplibreMap canvas, .maplibregl-canvas");
    const rect = canvas?.getBoundingClientRect();
    const top = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;
    return {
      reachableMarks: probe ? probe().length : null,
      centreTopIsCanvas: Boolean(canvas && top === canvas),
      centreTop: top
        ? {
            tag: top.tagName.toLowerCase(),
            className: typeof top.className === "string" ? top.className : "",
            ariaLabel: top.getAttribute("aria-label"),
          }
        : null,
    };
  });
  await testInfo.attach(name, {
    body: JSON.stringify(context, null, 2),
    contentType: "application/json",
  });
}

// The ready painted map, by the contract waitForLoadedMap in
// e2e/screenshots.spec.ts holds every map shot to, for a map nothing covers:
// everything expectRenderedMap reads, and at least one painted pub mark a tap
// would reach.
async function waitForLoadedMap(page: Page): Promise<void> {
  await expectRenderedMap(page);
  await expect
    .poll(() => paintedMapMarkCount(page), {
      message: "map visual gate requires at least one tappable painted pub mark",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
}

// Kept beside the run's results and attached to its report, so the parent run
// retains what each stage actually painted.
async function shot(target: Page | Locator, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function expectTonightSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("tonight-screen")).not.toHaveAttribute(
    "data-listings-status",
    "idle",
    { timeout: 20_000 },
  );
}

async function settled(page: Page): Promise<void> {
  const response = await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expectTonightSettled(page);
}

async function savedBytes(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

for (const viewport of VIEWPORTS) for (const theme of THEMES) {
  test(`${viewport.label} ${theme} Tonight links a saved pub back to the map, after the answer`, async ({ page }, testInfo) => {
    test.slow();
    const stage = (name: string) => `${viewport.label}-${viewport.width}-${theme}-${name}`;
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await seed(page, SAVED_RAW, theme);
    await settled(page);
    await expectTheme(page, theme);
    expect(await savedBytes(page)).toBe(SAVED_RAW);

    const cue = page.getByTestId("tonight-return-cue");
    await expect(cue).toBeVisible();
    await shot(cue, testInfo, stage("1-tonight-cue"));
    await expect(cue).toContainText("not from an account");
    await expect(cue).not.toContainText("Private list label");
    await expect(cue).not.toContainText("Private note text");
    await expect(cue).not.toContainText(COMMUNITY_SHEET_FIXTURE_VENUE_ID);

    const link = cue.getByRole("link", { name: "Open your saved pub on the map" });
    await expect(link).toHaveAttribute("href", COMMUNITY_SHEET_FIXTURE_MAP_PATH);

    // The answer comes first: the cue follows the lede region in the document.
    expect(
      await page.evaluate(() => {
        const lede = document.querySelector('[data-testid="tonight-lede"]');
        const cueNode = document.querySelector('[data-testid="tonight-return-cue"]');
        return Boolean(
          lede && cueNode && lede.compareDocumentPosition(cueNode) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // The cue is painted by the client after hydration, so its link is live.
    await link.click();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          sel: url.searchParams.get("sel"),
          accept: url.searchParams.get("accept"),
          src: url.searchParams.get("src"),
        };
      }, { timeout: 30_000 })
      .toEqual({ pathname: "/map", sel: COMMUNITY_SHEET_FIXTURE_VENUE_ID, accept: null, src: null });

    // The map opens on the saved pub itself.
    const mobileVenue = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    if (viewport.label === "mobile") {
      await expectMobileMapShellReady(page);
      await expect(
        mobileVenue.getByRole("heading", { name: COMMUNITY_SHEET_FIXTURE_VENUE_NAME }),
      ).toBeVisible({ timeout: 30_000 });
    } else {
      await expectSoleDesktopDrawer(page, "venue");
      await expect(
        desktopVenueDrawer(page).getByRole("heading", { name: COMMUNITY_SHEET_FIXTURE_VENUE_NAME }),
      ).toBeInViewport({ timeout: 30_000 });
    }
    // The selected pub's surface covers the map, so this state proves the map
    // rendered by signals that do not need a tap to reach it; the strict
    // tappable-mark gate runs on the uncovered map after the first Back.
    await expectRenderedMap(page);
    await attachHitContext(page, testInfo, stage("2-map-selected-hit-context"));
    await expectTheme(page, theme);
    expect(await savedBytes(page)).toBe(SAVED_RAW);
    await shot(page, testInfo, stage("2-map-selected-princess-louise"));

    // First Back closes the pub and leaves a clean map (§4.6); the second
    // returns to Tonight, where the cue is still there.
    await page.goBack();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return { pathname: url.pathname, sel: url.searchParams.get("sel") };
      })
      .toEqual({ pathname: "/map", sel: null });
    if (viewport.label === "mobile") await expect(mobileVenue).toHaveCount(0);
    else await expect(desktopVenueDrawer(page)).toHaveAttribute("aria-hidden", "true");
    await waitForLoadedMap(page);
    await expectTheme(page, theme);
    expect(await savedBytes(page)).toBe(SAVED_RAW);
    await shot(page, testInfo, stage("3-first-back-clean-map"));

    await page.goBack();
    await expect(page).toHaveURL(/\/tonight$/);
    await expectTonightSettled(page);
    await expect(cue).toBeVisible();
    await expect(link).toHaveAttribute("href", COMMUNITY_SHEET_FIXTURE_MAP_PATH);
    await expectTheme(page, theme);
    expect(await savedBytes(page)).toBe(SAVED_RAW);
    await shot(cue, testInfo, stage("4-second-back-tonight-cue"));

    // A reload reads the same saves again and still writes nothing back.
    const reloaded = await page.reload({ waitUntil: "domcontentloaded" });
    expect(reloaded?.status()).toBe(200);
    await expectTonightSettled(page);
    await expect(cue).toBeVisible();
    await expect(link).toHaveAttribute("href", COMMUNITY_SHEET_FIXTURE_MAP_PATH);
    await expectTheme(page, theme);
    expect(await savedBytes(page)).toBe(SAVED_RAW);
    await shot(cue, testInfo, stage("5-reload-tonight-cue"));
  });
}

for (const [label, raw] of [
  ["nothing saved", null],
  ["an empty list", "[]"],
  ["corrupt storage", "{not json"],
  ["a save the map cannot open", JSON.stringify([
    { venueId: "venue-does-not-exist", listType: "Want to Visit", savedAt: "2026-10-01T20:00:00.000Z" },
  ])],
] as const) {
  test(`Tonight shows no return cue with ${label}`, async ({ page }) => {
    await seed(page, raw);
    await settled(page);
    await expect(page.getByTestId("tonight-return-cue")).toHaveCount(0);
  });
}

test("with scripts off, Tonight renders and paints no return cue over real saves", async ({
  browser,
  baseURL,
}) => {
  test.slow();
  expect(baseURL).toBeTruthy();
  // Seed through the context's storage state: no init script runs with scripts
  // off. The same state with scripts on is the control that the seed is one a
  // hydrated Tonight would answer with a cue.
  const storageState = {
    cookies: [],
    origins: [{
      origin: new URL(baseURL!).origin,
      localStorage: [
        { name: "pubmaxx:analytics-consent:v1", value: "denied" },
        { name: "pubmax-tour-v1-done", value: "1" },
        { name: "pubmax_onboarding_dismissed", value: "1" },
        { name: STORAGE_KEY, value: SAVED_RAW },
      ],
    }],
  };

  const serverOnly = await browser.newContext({ baseURL, javaScriptEnabled: false, storageState });
  try {
    const page = await serverOnly.newPage();
    const response = await page.goto("/tonight", { waitUntil: "load" });
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    await expect(page.getByTestId("tonight-screen")).toBeVisible();
    await expect(page.getByTestId("tonight-return-cue")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open your saved pub on the map" })).toHaveCount(0);
  } finally {
    await serverOnly.close();
  }

  const hydrated = await browser.newContext({ baseURL, storageState });
  try {
    const page = await hydrated.newPage();
    await settled(page);
    await expect(page.getByTestId("tonight-return-cue")).toBeVisible();
  } finally {
    await hydrated.close();
  }
});
