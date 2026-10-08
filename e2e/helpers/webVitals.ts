import { readFileSync } from "node:fs";

import { expect, type CDPSession, type Page } from "@playwright/test";

import type { VitalsDevice } from "../../lib/webVitalsBaseline";

import { COMMUNITY_SHEET_FIXTURE_MAP_PATH } from "./communitySheetFixture";

/**
 * The ONE way a Core Web Vital is measured in this suite.
 *
 * e2e/helpers/perfMeasurement.ts measures what a route COSTS - bytes, requests,
 * server think time - and it already reads LCP and CLS on the way past. This
 * helper measures what a person FEELS: the same LCP and CLS taken under a named
 * device and a named cache temperature, plus the two things that file has never
 * had, INP and the product timings.
 *
 * They are separate on purpose rather than merged: the budget sweep's method
 * block is a tracked contract that seeded 35 ceilings, and widening it to carry
 * a second device, a second cache state and an interaction would re-seed every
 * one of those numbers. This lane is additive and reads none of them.
 *
 * HOW INP IS TAKEN, and what the figure is worth. Chrome exposes interaction
 * latency through the Event Timing API: an `event` entry carrying an
 * `interactionId` is one user interaction, and its `duration` is input
 * timestamp to next paint, which is exactly what INP is defined over. A field
 * INP is the ~p98 of a session's interactions; a lab run makes a handful, so
 * the honest lab reading is the WORST one, and that is what this returns.
 *
 * The API's `durationThreshold` floors at 16 ms by specification, so an
 * interaction faster than one frame reports no entry at all. That is reported
 * as INP_FLOOR_MS rather than as zero, because "we saw nothing" and "it took no
 * time" are different claims, and 16 ms is the honest upper bound on the first.
 */

/** The shortest interaction the Event Timing API will report. */
const INP_FLOOR_MS = 16;

export type VitalsReading = {
  lcpMs: number;
  inpMs: number;
  cls: number;
};

type VitalsProbe = {
  lcpMs: number;
  cls: number;
  inpMs: number;
  interactions: number;
};

type ProbeWindow = Window & { __pubmaxVitals?: VitalsProbe };

/**
 * The emulated devices, written out rather than taken from Playwright's own
 * device table, because a baseline is only a baseline while the rig it was
 * taken on is stated. The mobile row is the audit's own: a 390x844 phone under
 * a 4x CPU throttle on Slow 4G.
 *
 * Slow 4G is Chrome DevTools' own preset written out in its own units: a 150 ms
 * round trip, 1638.4 kbit/s down and 750 kbit/s up, each at 90% of nominal.
 * Those are the same figures Lighthouse applies for a mobile audit and the same
 * ones scripts/perf-baseline.mjs already pins, so a number taken here and a
 * number taken there describe one wire. It is slower than the Fast 4G profile
 * perf/route-budgets.json measures on, deliberately: R2 is about the phone in a
 * pub basement rather than the phone on the office wifi.
 */
export const VITALS_DEVICES: Record<
  VitalsDevice,
  {
    viewport: { width: number; height: number };
    cpuThrottleRate: number;
    network: {
      label: string;
      latencyMs: number;
      downloadBytesPerSecond: number;
      uploadBytesPerSecond: number;
    };
  }
> = {
  mobile: {
    viewport: { width: 390, height: 844 },
    cpuThrottleRate: 4,
    network: {
      label: "chrome-slow-4g",
      latencyMs: 150,
      // 1474.56 kbit/s and 675 kbit/s, in bytes.
      downloadBytesPerSecond: 188_743,
      uploadBytesPerSecond: 86_400,
    },
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    cpuThrottleRate: 1,
    network: {
      label: "chrome-fast-4g",
      latencyMs: 75,
      downloadBytesPerSecond: 1_012_500,
      uploadBytesPerSecond: 168_750,
    },
  },
};

/**
 * Installs the observers before any app code runs.
 *
 * `buffered: true` on each is what lets the probe report an entry that landed
 * before the observer was constructed, which for LCP is most of them.
 */
export async function installVitalsProbe(page: Page): Promise<void> {
  await page.addInitScript((floorMs: number) => {
    // A returning visitor: the first-run overlays are their own chunks and
    // their own paints, and a baseline about them is a baseline about the tour.
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");

    const probeWindow = window as Window & {
      __pubmaxVitals?: {
        lcpMs: number;
        cls: number;
        inpMs: number;
        interactions: number;
      };
    };
    probeWindow.__pubmaxVitals = {
      lcpMs: Number.NaN,
      cls: 0,
      inpMs: 0,
      interactions: 0,
    };
    const probe = probeWindow.__pubmaxVitals;

    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) probe.lcpMs = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >) {
          if (!entry.hadRecentInput) probe.cls += entry.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { interactionId?: number; duration: number }
        >) {
          // No interactionId means it was not a user interaction: a
          // programmatic dispatch, or an event type the API reports without
          // grouping. Counting one would report the app as slower than a
          // person ever found it.
          if (!entry.interactionId) continue;
          probe.interactions += 1;
          probe.inpMs = Math.max(probe.inpMs, entry.duration);
        }
      }).observe({ type: "event", durationThreshold: floorMs, buffered: true });
    } catch {}
  }, INP_FLOOR_MS);
}

/**
 * ONE CDP session per page, for the whole sweep.
 *
 * A sweep asks for a device and a cold cache on every single sample, and each
 * `newCDPSession` opens another protocol client that is never closed. At five
 * runs across six routes, two temperatures and two devices that is over a
 * hundred live sessions on one page, and the browser slows under them until a
 * cell that took ninety seconds early in a run takes twenty minutes late in it.
 * That is a measurement reporting the harness rather than the product, so the
 * session is opened once and reused.
 */
const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

function vitalsSession(page: Page): Promise<CDPSession> {
  const existing = cdpSessions.get(page);
  if (existing) return existing;
  const created = page.context().newCDPSession(page);
  cdpSessions.set(page, created);
  return created;
}

/** Applies one device's viewport, CPU throttle and network profile. */
export async function applyVitalsDevice(page: Page, device: VitalsDevice): Promise<void> {
  const profile = VITALS_DEVICES[device];
  await page.setViewportSize(profile.viewport);
  const session = await vitalsSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottleRate });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.network.latencyMs,
    downloadThroughput: profile.network.downloadBytesPerSecond,
    uploadThroughput: profile.network.uploadBytesPerSecond,
  });
}

/**
 * Puts the browser back to a COLD state: no HTTP cache, no cookies, no storage.
 *
 * A warm run is then simply a later load of the same URL in the same context,
 * which is what a returning drinker gets. The two are recorded apart because
 * they answer different questions, and a table reporting only one of them can
 * be read as either.
 */
export async function coolBrowser(page: Page): Promise<void> {
  const session = await vitalsSession(page);
  await session.send("Network.clearBrowserCache");
  await page.context().clearCookies();
  try {
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  } catch {
    // about:blank has no storage to clear.
  }
}

/** The shipped cold-open script, and the arm every ordinary run measures. */
export const SHIPPED_MAP_INIT_SCRIPT = "public/map-first-paint-init.js";

/**
 * Serves the map's cold-open init script for this page from a named file.
 *
 * A before-and-after table needs both arms, and the obvious way to get the
 * "before" one - reverting the file in the working tree - means the fix sits
 * uncommitted for as long as the measuring takes, and it silently rewrites what
 * an already-running server is handing out. So the arm is chosen at the wire
 * instead: the tree always holds the shipped script, and a run that wants the
 * previous behaviour names a file to serve in its place.
 *
 * EVERY run goes through this interception, including the one measuring the
 * shipped script, and that is the whole point rather than tidiness. Playwright
 * fulfils an intercepted request from the harness rather than from the browser
 * cache, so an intercepted route is measured cold on every load while an
 * un-intercepted one is not: the first paired run read `/map` warm at 6392 ms
 * with interception against 2156 ms without it, on one build. Comparing an
 * intercepted arm against an un-intercepted one would have credited the fix
 * with the whole of that difference.
 */
export async function serveMapInitScript(page: Page, filePath: string): Promise<void> {
  const body = readFileSync(filePath, "utf8");
  await page.route("**/map-first-paint-init.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=UTF-8",
      // The shipped headers, so an intercepted load and a served one differ in
      // the script's text and in nothing else a browser can see.
      headers: {
        "cache-control": "public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800",
      },
      body,
    }),
  );
}

/** Reads the probe. A page that never installed it reads as unmeasured. */
export async function readVitals(page: Page): Promise<VitalsReading> {
  const probe = await page.evaluate(() => {
    const probeWindow = window as ProbeWindow;
    return (
      probeWindow.__pubmaxVitals ?? {
        lcpMs: Number.NaN,
        cls: Number.NaN,
        inpMs: Number.NaN,
        interactions: 0,
      }
    );
  });
  return {
    lcpMs: probe.lcpMs,
    cls: probe.cls,
    // Nothing reported means every interaction finished inside one frame. The
    // floor is the honest upper bound on that, never zero.
    inpMs: probe.interactions === 0 ? INP_FLOOR_MS : Math.max(probe.inpMs, INP_FLOOR_MS),
  };
}

/**
 * What counts as the primary action on each route, and how it is exercised.
 *
 * `kind` matters because the two make different work: a click runs a handler
 * and paints, while a keystroke runs a controlled input's whole render pass,
 * and the composer's field is the one place on the site where a person types
 * under time pressure.
 *
 * A route whose primary action NAVIGATES has its navigation suppressed by the
 * harness before the tap. INP is a measure of one document's responsiveness, so
 * a tap that tears the document down reports nothing at all; suppressing the
 * default keeps the handler, the React work and the paint, which is the part
 * the number is about.
 */
export type PrimaryInteraction = {
  /** Playwright selector for the control. */
  selector: string;
  kind: "click" | "type";
  /** Typed when `kind` is "type". */
  text?: string;
  /** What the interaction is, for the recorded table. */
  label: string;
};

export const PRIMARY_INTERACTIONS: Record<string, PrimaryInteraction> = {
  "/": {
    selector: "[data-primary-action] a, [data-primary-action] button",
    kind: "click",
    label: "the landing's one painted primary",
  },
  "/tonight": {
    selector: "[data-primary-action] a, [data-primary-action] button",
    kind: "click",
    label: "See them on the map",
  },
  "/today": {
    selector: "[data-primary-action] a, [data-primary-action] button",
    kind: "click",
    label: "Find my pint",
  },
  "/pal": {
    selector: "[data-primary-action] button",
    kind: "click",
    label: "Meet your Pub Pal",
  },
  "/plan": {
    selector: "#plan-describe-first-query",
    kind: "type",
    text: "quiet in Clapham",
    label: "typing the outing into describe-first",
  },
  "/map": {
    selector: ".mapCompassBtn, .mapFitLondonBtn, .mobileSheetPortal button:has-text('Reset view')",
    kind: "click",
    label: "a map chrome control",
  },
  [COMMUNITY_SHEET_FIXTURE_MAP_PATH]: {
    selector: ".venueInspector [role='tab']",
    kind: "click",
    label: "a venue sheet tab",
  },
};

/**
 * Suppresses navigation for the duration of one interaction.
 *
 * Registered in the page rather than the harness because the decision has to be
 * made inside the click's own dispatch, before the browser commits to a
 * navigation. It refuses the default and nothing else: the handler still runs,
 * React still renders, and the frame is still painted, so the event entry the
 * probe reads describes the same work a person's tap does.
 */
async function suppressNavigation(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest("a[href]")) event.preventDefault();
      },
      true,
    );
  });
}

/** How long a primary action gets to become actionable before it is a no-show. */
const PRIMARY_ACTION_TIMEOUT_MS = 20_000;

/**
 * Browser state one sample's own interaction leaves behind for the next one.
 *
 * A WARM row is about a warm CACHE, and nothing else. `/pal` writes an
 * onboarding draft the moment its primary is tapped, so the warm sample
 * inherited the cold sample's draft and measured the ONBOARDING screen while
 * the cold row measured the meeting screen - two different screens, two
 * different LCP elements, recorded as one route's cold and warm figures. The
 * residue is the harness's own, not a visitor's, so it is cleared before every
 * sample; the HTTP cache, which is what the row is about, is untouched.
 */
const SAMPLE_RESIDUE_KEY_PREFIXES: Record<string, readonly string[]> = {
  // lib/pubPal.ts PAL_ONBOARDING_DRAFT_KEY, plus the anonymous owner id it is
  // suffixed with. Cleared by prefix so the owner suffix need not be guessed.
  "/pal": ["pubmaxx.pub-pal-onboarding"],
};

const residueGuards = new WeakMap<Page, Set<string>>();

/** Clears what the previous sample's own interaction left in this browser. */
export async function clearSampleResidue(page: Page, routePath: string): Promise<void> {
  const prefixes = SAMPLE_RESIDUE_KEY_PREFIXES[routePath];
  if (!prefixes) return;
  const guardedRoutes = residueGuards.get(page) ?? new Set<string>();
  if (!guardedRoutes.has(routePath)) {
    // The leaving Pal document saves again on pagehide. Clear that late draft
    // in the next document before the app restores it, without cooling cache.
    await page.addInitScript(({ pathname, keyPrefixes }) => {
      if (window.location.pathname !== pathname) return;
      for (const key of Object.keys(window.localStorage)) {
        if (keyPrefixes.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
      }
    }, { pathname: routePath, keyPrefixes: prefixes });
    guardedRoutes.add(routePath);
    residueGuards.set(page, guardedRoutes);
  }
  try {
    await page.evaluate((keyPrefixes: readonly string[]) => {
      for (const key of Object.keys(window.localStorage)) {
        if (keyPrefixes.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
      }
    }, prefixes);
  } catch {
    // about:blank has no storage to clear.
  }
}

/** Runs one route's primary interaction, so the probe has an INP to report. */
export async function exercisePrimaryAction(page: Page, routePath: string): Promise<boolean> {
  const interaction = PRIMARY_INTERACTIONS[routePath];
  if (!interaction) return false;
  const control = page.locator(interaction.selector).first();
  try {
    if (routePath === "/map") {
      // The camera actions live inside Layers on both layouts. Open their
      // real surface before measuring the action, including the opening tap.
      const more = page.getByRole("button", { name: "More map controls", exact: true });
      const layers = page.getByRole("button", { name: /^Map layers:/ });
      await more.or(layers).filter({ visible: true }).first().waitFor({
        state: "visible",
        timeout: PRIMARY_ACTION_TIMEOUT_MS,
      });
      if (await more.isVisible()) {
        // A warm navigation can restore the modal sheet over the canvas.
        // Close it before sending a real camera key to the map.
        if ((await more.getAttribute("aria-expanded")) === "true") {
          await page.getByRole("button", { name: "Close Map controls", exact: true }).click();
          await expect(more).toHaveAttribute("aria-expanded", "false");
        }
        // Reset view is disabled at the designed attitude. A real keyboard
        // rotation makes the phone's camera action meaningful and actionable.
        const canvas = page.locator(".maplibregl-canvas").first();
        await canvas.focus();
        await expect(canvas).toBeFocused();
        await canvas.press("Shift+ArrowLeft");
        await expect(async () => {
          if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
          await page.getByRole("tab", { name: "Layers", exact: true }).click();
          await expect(control).toBeEnabled({ timeout: 1_000 });
        }).toPass({ timeout: PRIMARY_ACTION_TIMEOUT_MS });
      } else {
        await expect(async () => {
          if (!(await control.isVisible())) await layers.click({ timeout: PRIMARY_ACTION_TIMEOUT_MS });
          await expect(control).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: PRIMARY_ACTION_TIMEOUT_MS });
      }
    }
    await control.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return false;
  }

  if (interaction.kind === "type") {
    await control.click();
    // One key at a time with a gap between: a burst is coalesced into one
    // interaction and would report the cheapest of the keystrokes rather than
    // the render pass each one really costs.
    for (const character of interaction.text ?? "quiet") {
      await control.press(character === " " ? "Space" : character);
      await page.waitForTimeout(120);
    }
  } else {
    await suppressNavigation(page);
    // BOUNDED, because Playwright's default action timeout here is no timeout
    // at all: a control that is in the document and DISABLED passes the
    // visibility wait above and then waits for ever to become actionable. One
    // /pal cell wedged a whole record run that way. An unactionable control is
    // reported as un-interacted, which the sweep already fails on by name.
    try {
      await control.click({ timeout: PRIMARY_ACTION_TIMEOUT_MS });
    } catch {
      return false;
    }
  }

  // The event entry is reported after the interaction's own paint, so give the
  // page frames to produce one before reading.
  await page.waitForTimeout(600);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return true;
}

/** How long a product timing may take before the harness gives up on it. */
export const PRODUCT_TIMING_CEILING_MS = 180_000;

/** Milliseconds from this document's navigation start until the condition held. */
function msFromNavigationStart(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** /map: navigation to the first pin a thumb could land on. */
export async function timeMapUsableVenues(page: Page, path = "/map"): Promise<number> {
  await page.goto(path, { waitUntil: "commit" });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const probe = (
            window as Window & { __pubmaxPaintedMapTapPoints?: () => unknown[] }
          ).__pubmaxPaintedMapTapPoints;
          return typeof probe === "function" ? probe().length : 0;
        }),
      { timeout: PRODUCT_TIMING_CEILING_MS, intervals: [250] },
    )
    .toBeGreaterThan(0);
  return msFromNavigationStart(page);
}

/** /map?sel=: navigation to a venue sheet a reader can read. */
export async function timeVenueSheet(page: Page, path: string): Promise<number> {
  await page.goto(path, { waitUntil: "commit" });
  await expect(page.locator(".venueInspector").first()).toBeVisible({
    timeout: PRODUCT_TIMING_CEILING_MS,
  });
  return msFromNavigationStart(page);
}

/** /plan: navigation to a composer field a person can type into. */
export async function timePlanEditable(page: Page): Promise<number> {
  await page.goto("/plan", { waitUntil: "commit" });
  await expect(page.locator("#plan-describe-first-query")).toBeEditable({
    timeout: PRODUCT_TIMING_CEILING_MS,
  });
  return msFromNavigationStart(page);
}
