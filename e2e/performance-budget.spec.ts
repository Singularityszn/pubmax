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
//     same-origin script the route pulled in before it settled.
//   requests — how many same-origin requests it took to get there. A route can
//     hold its bytes and still lose the night to a waterfall.
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

async function loadRoute(page: Page, route: RouteBudget): Promise<void> {
  await page.goto(route.path);
  await expect(page.locator(route.readySelector).first()).toBeVisible({
    timeout: ROUTE_READY_TIMEOUT_MS,
  });
  if (route.settledSelectorHidden) {
    await expect(page.locator(route.settledSelectorHidden)).toBeHidden({
      timeout: ROUTE_READY_TIMEOUT_MS,
    });
  }
  // Best effort: the sample is anchored to the settled network rather than to a
  // wall-clock moment, so the CPU throttle cannot change what has arrived yet.
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function sampleRoute(page: Page, route: RouteBudget): Promise<Sample> {
  await loadRoute(page, route);
  return page.evaluate(() => {
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
  });
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
