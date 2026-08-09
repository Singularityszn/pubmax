import { expect, test, type Page } from "@playwright/test";

import {
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  formatBreachTable,
  formatMeasurementTable,
  median,
  type RouteBudget,
  type RouteMeasurement,
} from "../lib/performanceBudgets";

// The enforced site performance budget (docs/PERFORMANCE_BUDGETS.md).
//
// One spec measures every budgeted route against perf/route-budgets.json and
// fails with an over-budget table naming what went past which ceiling. It runs
// against the production build Playwright's webServer already builds, because
// a dev-server measurement would be a number about webpack rather than about
// what a drinker downloads.
//
// WHAT IS MEASURED, and why each is the honest proxy:
//   serverRenderMs — responseStart minus requestStart on the document's own
//     navigation entry. Over loopback that is server think time with no network
//     in it, which is the part of a production TTFB the code owns.
//   jsDecodedKB — decoded (so: parse cost, not transfer cost) bytes of every
//     same-origin script the route asked for before it was interactive.
//   requests — how many same-origin requests it took to get there. A route can
//     hold its bytes and still lose the night to a waterfall.
//
// WHERE "BEFORE INTERACTIVE" IS CUT, and why it is not networkidle: the app
// deliberately warms the OTHER tab destinations once the foreground surface
// says it has painted (lib/backgroundWarmup.ts). Those chunks are off the
// critical path by design, but they are exactly what a time-based settle
// catches or misses depending on how fast the box is: the first CI run of this
// spec measured /today at 2726 KB and the retry at 1186 KB, on one build. So
// the cut is an APP-DEFINED moment rather than a wall clock — the route's own
// readiness gate, no earlier than the window load event — and a resource counts
// if it STARTED before that moment. The run then waits for the network to go
// quiet so every counted entry carries its final size, and anything the warmup
// began afterwards is excluded by construction rather than by luck.
//
// Cross-origin requests are refused for the whole run, so the numbers describe
// what we ship and never a tile server's morning. Each route gets a warm-up
// load that is thrown away (the first hit on any route pays a module load the
// second visitor never pays), then the median of the measured runs.
//
// Gated on PUBMAX_PERF_BUDGET so the ordinary browser suite does not pay for
// it; the CI job that owns it sets the variable.

type Sample = RouteMeasurement;

const budgets = PERFORMANCE_BUDGETS;

// The whole sweep in one test: the server is shared, so the routes must be
// measured one after another rather than raced by parallel workers.
const SWEEP_TIMEOUT_MS =
  60_000 * budgets.routes.length * (budgets.method.warmupRuns + budgets.method.measuredRuns);

const ROUTE_READY_TIMEOUT_MS = 45_000;

async function blockThirdParties(page: Page, origin: string): Promise<void> {
  if (!budgets.method.thirdPartyBlocked) return;
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    return route.abort();
  });
}

async function throttleCpu(page: Page): Promise<void> {
  const rate = budgets.method.cpuThrottleRate;
  if (!rate || rate <= 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
}

/** No new resource entry for this long counts as the network having gone quiet. */
const NETWORK_QUIET_MS = 1_500;
const NETWORK_QUIET_CEILING_MS = 20_000;

/** Loads the route and returns the interactive moment on the page's own clock. */
async function loadRoute(page: Page, route: RouteBudget): Promise<number> {
  await page.goto(route.path, { waitUntil: "load" });
  await expect(page.locator(route.readySelector).first()).toBeVisible({
    timeout: ROUTE_READY_TIMEOUT_MS,
  });
  if (route.settledSelectorHidden) {
    await expect(page.locator(route.settledSelectorHidden)).toBeHidden({
      timeout: ROUTE_READY_TIMEOUT_MS,
    });
  }
  return page.evaluate(() => performance.now());
}

/** Waits until nothing new has been requested for a while, so sizes are final. */
async function waitForQuietNetwork(page: Page): Promise<void> {
  await page.evaluate(
    async ([quietMs, ceilingMs]) => {
      let seen = performance.getEntriesByType("resource").length;
      let quietSince = performance.now();
      const deadline = performance.now() + ceilingMs;
      while (performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const now = performance.getEntriesByType("resource").length;
        if (now !== seen) {
          seen = now;
          quietSince = performance.now();
        } else if (performance.now() - quietSince >= quietMs) {
          return;
        }
      }
    },
    [NETWORK_QUIET_MS, NETWORK_QUIET_CEILING_MS] as const,
  );
}

async function sampleRoute(page: Page, route: RouteBudget): Promise<Sample> {
  const interactiveAt = await loadRoute(page, route);
  await waitForQuietNetwork(page);
  return page.evaluate((boundary) => {
    const origin = location.origin;
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    let jsBytes = 0;
    let requests = 0;
    for (const entry of performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]) {
      if (!entry.name.startsWith(origin)) continue;
      // Asked for before the route was interactive, whenever it finished.
      if (entry.startTime > boundary) continue;
      requests += 1;
      const isJs = entry.initiatorType === "script" || /\.js(\?|$)/.test(entry.name);
      if (isJs) jsBytes += entry.decodedBodySize || 0;
    }
    return {
      // The document itself is a request too, and it is the one that pays the
      // server render, so it counts.
      requests: requests + 1,
      jsDecodedKB: Math.round(jsBytes / 1024),
      serverRenderMs: navigation
        ? Math.round(navigation.responseStart - navigation.requestStart)
        : Number.NaN,
    };
  }, interactiveAt);
}

test("every budgeted route stays inside its performance budget", async ({ page, baseURL }) => {
  test.skip(!process.env.PUBMAX_PERF_BUDGET, "Owned by the performance-budget CI job.");
  test.setTimeout(SWEEP_TIMEOUT_MS);

  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await page.setViewportSize(budgets.method.viewport);
  // First-run surfaces are their own chunks and their own overlays; a budget is
  // about the route, so they are dismissed the way a returning visitor has them.
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The default buffer holds 250 entries and a busy route is close to it;
    // a dropped entry would read as a route that asked for less than it did.
    performance.setResourceTimingBufferSize(1000);
  });
  await blockThirdParties(page, origin);
  await throttleCpu(page);

  const measured = new Map<string, RouteMeasurement>();
  for (const route of budgets.routes) {
    for (let run = 0; run < budgets.method.warmupRuns; run += 1) {
      await loadRoute(page, route);
    }
    const samples: Sample[] = [];
    for (let run = 0; run < budgets.method.measuredRuns; run += 1) {
      samples.push(await sampleRoute(page, route));
    }
    measured.set(route.path, {
      serverRenderMs: median(samples.map((sample) => sample.serverRenderMs)),
      jsDecodedKB: median(samples.map((sample) => sample.jsDecodedKB)),
      requests: median(samples.map((sample) => sample.requests)),
    });
  }

  console.log(`[perf-budget]\n${formatMeasurementTable(budgets.routes, measured)}`);

  const breaches = findBudgetBreaches(budgets.routes, measured);
  expect(
    breaches,
    breaches.length === 0
      ? "no breach"
      : `Over the performance budget. Fix the route or take the ceiling up deliberately (docs/PERFORMANCE_BUDGETS.md).\n\n${formatBreachTable(breaches)}\n`,
  ).toEqual([]);
});
