import { expect, type Page, type Request } from "@playwright/test";

import {
  PERFORMANCE_BUDGETS,
  median,
  resolveCountBoundary,
  routeNeedsMoreEvidence,
  type BudgetMethod,
  type BudgetMetric,
  type PerfBoundarySource,
} from "../../lib/performanceBudgets";

/**
 * The ONE way a route's cost is measured in this suite.
 *
 * Two specs read these numbers - e2e/performance-budget.spec.ts, which enforces
 * perf/route-budgets.json, and e2e/ux-lane-perf-verification.spec.ts, which
 * reports the same routes plus LCP and CLS - and two figures are only
 * comparable when they were taken the same way. So the method lives here once:
 * the tracked warm-up and median runs, the CPU throttle, the third-party block,
 * and the app-defined cut for what counts as "before interactive".
 *
 * WHERE "BEFORE INTERACTIVE" IS CUT, and why it is not a wall clock: the app
 * deliberately warms the OTHER tab destinations once the foreground surface
 * says it has painted (lib/mapWarmup.ts schedules that on an idle callback with
 * a 2000 ms timeout). Those chunks are off the critical path by design, but a
 * time-based settle catches or misses them depending on how fast the box is:
 * the first CI run measured /today at 2726 KB and the retry at 1186 KB, on one
 * build. So the cut is the route's own readiness gate, no earlier than the
 * window load event, and a resource counts if it STARTED before that moment.
 * The run then waits for the network to go quiet so every counted entry carries
 * its final size.
 *
 * WHOSE CLOCK MAKES THAT CUT is the other half, and it is the half #1314 was
 * about. The rule above was already right; the clock was wrong. Playwright
 * learns a selector is visible by POLLING and learns the page clock by a round
 * trip after that, so a harness-timed boundary lands a poll interval plus a
 * round trip late and drifts with runner load. The same idle prefetch burst
 * then falls inside the count or outside it: `/today` measured 43 requests and
 * then 54 on identical code, on a docs-only commit.
 *
 * So the boundary is timestamped BY THE PAGE. An init script installs a gate
 * that watches this route's own readiness selectors frame by frame and records
 * the first frame they held, against the document's own time origin - the same
 * origin `loadEventEnd` and every resource `startTime` already use. The harness
 * figure survives only as a named fallback, so a run that had to use it says so
 * rather than quietly reading as a heavier route.
 */
export type PerfRoute = {
  /** The path measured, exactly as a browser would open it. */
  path: string;
  /** Rendered proof the route arrived; measurement waits for it. */
  readySelector: string;
  /** Optional loading affordance that must be gone before measuring. */
  settledSelectorHidden?: string;
  /**
   * The route's own ceilings, when the caller passed a budget row rather than a
   * bare path. Read for one purpose: a figure that lands ON the line is worth
   * more evidence than one with room either side, so an answer near a ceiling
   * is measured again. Nothing here decides pass or fail; that stays with
   * lib/performanceBudgets.
   */
} & Partial<Record<BudgetMetric, number>>;

export type PerfSample = {
  serverRenderMs: number;
  jsDecodedKB: number;
  requests: number;
  lcpMs: number;
  cls: number;
  /** Which clock cut the count. `harness-ready` means the in-page gate never held. */
  boundarySource: PerfBoundarySource;
  /** Connections still open when the wait ended, if any. Reported, never failed on. */
  stillOpen: string[];
};

/** One route's samples, kept so a run can print the spread beside the median. */
export type PerfRouteRun = {
  aggregate: PerfSample;
  samples: PerfSample[];
};

/** The shape the in-page gate publishes. Mirrored by the init script below. */
type PerfGate = {
  readyAt: number;
  lcpMs: number;
  cls: number;
};

/**
 * How long the harness WAITS for a route to say it is ready. It is not a
 * ceiling and it never fails a budget: the ceilings are the four figures in
 * perf/route-budgets.json, and this only decides when to give up on a route
 * that is never going to answer. It is generous because the sweep runs under a
 * 4x CPU throttle AND a throttled wire, where /map's own loading chrome clears
 * well after a minute on a busy box - and a route that times out here is
 * reported as unmeasured, which findBudgetBreaches already treats as a breach
 * of every metric.
 */
export const ROUTE_READY_TIMEOUT_MS = 120_000;

export function aggregatePerfMetric(values: readonly number[]): number {
  if (values.some((value) => !Number.isFinite(value))) return Number.NaN;
  return median(values);
}

/**
 * How long counts as quiet, and how long a run waits before giving up, both off
 * the tracked network profile. They are NOT constants here because they are not
 * constant: over a throttled wire an ordinary gap between two requests is
 * longer than a whole loopback load, so a window sized for loopback would call
 * a route finished in the middle of its own waterfall, and a drain ceiling
 * sized for loopback fails the heaviest route on a wire it was never measured
 * against.
 */
function quietWindow(
  method: BudgetMethod,
): { quietMs: number; ceilingMs: number; streamAfterMs: number } {
  return {
    quietMs: method.network?.quietMs ?? 1_500,
    ceilingMs: method.network?.drainCeilingMs ?? 20_000,
    streamAfterMs: method.network?.streamAfterMs ?? 20_000,
  };
}

type NetworkTracker = {
  /** Each in-flight request against the moment it started, so a stream can be told from a resource. */
  active: Map<Request, number>;
  revision: number;
};

/** What stayed open past the drain ceiling on the last wait, if anything. */
export type QuietOutcome = { drained: true } | { drained: false; stillOpen: string[] };

const networkTrackers = new WeakMap<Page, NetworkTracker>();

function ensureNetworkTracker(page: Page): NetworkTracker {
  const existing = networkTrackers.get(page);
  if (existing) return existing;

  const tracker: NetworkTracker = { active: new Map(), revision: 0 };
  const start = (request: Request) => {
    tracker.active.set(request, Date.now());
    tracker.revision += 1;
  };
  const finish = (request: Request) => {
    tracker.active.delete(request);
    tracker.revision += 1;
  };
  page.on("request", start);
  page.on("requestfinished", finish);
  page.on("requestfailed", finish);
  networkTrackers.set(page, tracker);
  return tracker;
}

/**
 * First-run surfaces are their own chunks and their own overlays, the CPU is
 * throttled and cross-origin requests are refused, so a run describes what we
 * ship to a returning visitor rather than a tile server's morning.
 */
export async function preparePerfPage(
  page: Page,
  origin: string,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
  routes: readonly PerfRoute[] = PERFORMANCE_BUDGETS.routes,
): Promise<void> {
  ensureNetworkTracker(page);
  await page.setViewportSize(method.viewport);
  // The whole route table is baked in at registration, and the gate picks its
  // own row off `location.pathname` at run time. That is what lets ONE init
  // script serve every navigation: an init script cannot be re-registered per
  // route, and a per-route registration would leave the gate for the previous
  // route still watching this one.
  const gateRoutes = routes.map((route) => ({
    path: route.path,
    readySelector: route.readySelector,
    settledSelectorHidden: route.settledSelectorHidden ?? null,
  }));
  await page.addInitScript((gate) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The default buffer holds 250 entries and a busy route is close to it;
    // a dropped entry would read as a route that asked for less than it did.
    performance.setResourceTimingBufferSize(1000);

    const gateWindow = window as typeof window & {
      __pubmaxPerfPaint?: { readyAt: number; lcpMs: number; cls: number };
    };
    gateWindow.__pubmaxPerfPaint = { readyAt: Number.NaN, lcpMs: Number.NaN, cls: 0 };
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) gateWindow.__pubmaxPerfPaint!.lcpMs = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { hadRecentInput?: boolean; value?: number }
        >) {
          if (!entry.hadRecentInput) {
            gateWindow.__pubmaxPerfPaint!.cls += entry.value ?? 0;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}

    const row = gate.routes.find((candidate) => {
      const [pathOnly] = candidate.path.split("?");
      return pathOnly === location.pathname;
    });
    if (!row) return;

    // Deliberately no stricter than Playwright's own visibility rule, which is
    // a non-empty box that is not `visibility: hidden`. A stricter test here
    // would leave the gate unsatisfied on a route the harness calls ready, and
    // the run would silently drop to the fallback clock it exists to replace.
    const visible = (element: Element): boolean => {
      if (element.getClientRects().length === 0) return false;
      return getComputedStyle(element).visibility !== "hidden";
    };
    const held = (): boolean => {
      const ready = document.querySelector(row.readySelector);
      if (!ready || !visible(ready)) return false;
      if (!row.settledSelectorHidden) return true;
      const settling = document.querySelectorAll(row.settledSelectorHidden);
      for (const element of Array.from(settling)) {
        if (visible(element)) return false;
      }
      return true;
    };

    const tick = () => {
      if (Number.isFinite(gateWindow.__pubmaxPerfPaint!.readyAt)) return;
      if (held()) {
        gateWindow.__pubmaxPerfPaint!.readyAt = performance.now();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { routes: gateRoutes });

  if (method.thirdPartyBlocked) {
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      return route.abort();
    });
  }

  const rate = method.cpuThrottleRate;
  const network = method.network;
  const throttlesNetwork = network && network.profile !== "loopback";
  if ((rate && rate > 1) || throttlesNetwork) {
    const session = await page.context().newCDPSession(page);
    if (rate && rate > 1) {
      await session.send("Emulation.setCPUThrottlingRate", { rate });
    }
    if (throttlesNetwork) {
      // Loopback is not a network. A route can hold every byte ceiling and
      // still lose the night to a waterfall, and a waterfall only costs
      // anything where a round trip does - so the rig pins one named profile
      // with its own numbers rather than measuring over a wire nobody has.
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: network.latencyMs,
        downloadThroughput: network.downloadBytesPerSecond,
        uploadThroughput: network.uploadBytesPerSecond,
      });
    }
  }
}

/**
 * Every route starts from the same state, because one sweep shares one page.
 *
 * Without this the sweep measures whatever the PREVIOUS route left behind. It
 * showed up as a bimodal `/map`: 144 requests on one sweep and 324 on the next,
 * with a 0% spread WITHIN each - so not noise, but two different starting
 * states. The map remembers a location and a viewport
 * (`lib/mapWarmup.ts` and the cached location-first opening), and how much it
 * remembers decides how many shards it streams before its own loading chrome
 * clears. A budget that swings 2x on what an earlier route happened to store is
 * not a budget.
 *
 * Clearing puts the route back on the tracked footing: cold on the warm-up load
 * the method already discards, warm on the three it measures, and identical for
 * every route in the sweep.
 */
async function resetPerfState(page: Page): Promise<void> {
  await page.context().clearCookies();
  try {
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  } catch {
    // The first route in a sweep is still on about:blank, which has no storage
    // to clear and no state to leak.
  }
}

/** Loads the route and returns the interactive moment on the page's own clock. */
export async function loadPerfRoute(page: Page, route: PerfRoute): Promise<number> {
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
export async function waitForQuietNetwork(
  page: Page,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<QuietOutcome> {
  const { quietMs, ceilingMs, streamAfterMs } = quietWindow(method);
  const tracker = ensureNetworkTracker(page);
  let seenRevision = tracker.revision;
  let quietSince = Date.now();
  const deadline = Date.now() + ceilingMs;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const now = Date.now();

    // A connection open this long is a STREAM, not a resource still arriving.
    // /today holds one for the life of the page, and treating it as activity
    // meant the run sat out the whole drain ceiling on every single load: 90
    // seconds a load, four loads a route, which is most of a CI wall spent
    // waiting for something that is not in the figures anyway.
    const streaming: Request[] = [];
    let settling = 0;
    for (const [request, startedAt] of tracker.active) {
      if (now - startedAt >= streamAfterMs) streaming.push(request);
      else settling += 1;
    }

    // Quiet means nothing NEW started and nothing is still arriving. A stream
    // is neither, so it does not hold the window open.
    if (tracker.revision !== seenRevision || settling > 0) {
      seenRevision = tracker.revision;
      quietSince = now;
    }

    if (now >= deadline && tracker.active.size > 0) {
      // The hard stop: something is still arriving and has been for the whole
      // ceiling. End the wait and name it rather than hanging the sweep.
      return {
        drained: false,
        stillOpen: [...tracker.active.keys()].map((request) => request.url()),
      };
    }

    if (now - quietSince < quietMs) continue;
    if (streaming.length > 0) {
      return { drained: false, stillOpen: streaming.map((request) => request.url()) };
    }
    return { drained: true };
  }
}

/** One load, measured. */
export async function samplePerfRoute(
  page: Page,
  route: PerfRoute,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<PerfSample> {
  const harnessReadyAtMs = await loadPerfRoute(page, route);
  const quiet = await waitForQuietNetwork(page, method);
  const { gate, loadEventEndMs } = await page.evaluate(() => {
    const gateWindow = window as typeof window & {
      __pubmaxPerfPaint?: { readyAt: number; lcpMs: number; cls: number };
    };
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    return {
      gate: gateWindow.__pubmaxPerfPaint ?? {
        readyAt: Number.NaN,
        lcpMs: Number.NaN,
        cls: 0,
      },
      loadEventEndMs: navigation ? navigation.loadEventEnd : Number.NaN,
    };
  });

  // The one decision this whole helper exists to make. It is a pure function in
  // lib/performanceBudgets.ts so it is unit-tested without a browser.
  const { boundaryMs, source } = resolveCountBoundary({
    loadEventEndMs,
    pageReadyAtMs: (gate as PerfGate).readyAt,
    harnessReadyAtMs,
  });

  const counted = await page.evaluate((boundary) => {
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
  }, boundaryMs);

  return {
    ...counted,
    lcpMs: (gate as PerfGate).lcpMs,
    cls: (gate as PerfGate).cls,
    boundarySource: source,
    stillOpen: quiet.drained ? [] : quiet.stillOpen,
  };
}

/**
 * The tracked method end to end: warm-up loads drain fully before a real
 * three-sample median. Without the drain, late warm-up requests can race into
 * the first sample and make identical builds report different route costs.
 */
export async function measurePerfRoute(
  page: Page,
  route: PerfRoute,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<PerfSample> {
  return (await runPerfRoute(page, route, method)).aggregate;
}

/**
 * The same run, with its individual samples kept.
 *
 * #1314 asked for exactly this before choosing a fix: a run that reports only
 * its median cannot say whether a swing happened inside the run or between
 * runs, and those two have different fixes.
 */
export async function runPerfRoute(
  page: Page,
  route: PerfRoute,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): Promise<PerfRouteRun> {
  await resetPerfState(page);
  for (let run = 0; run < method.warmupRuns; run += 1) {
    await loadPerfRoute(page, route);
    await waitForQuietNetwork(page, method);
  }
  const samples: PerfSample[] = [];
  for (let run = 0; run < method.measuredRuns; run += 1) {
    samples.push(await samplePerfRoute(page, route, method));
  }
  // A median of 3 is only a median when the samples agree, and a median sitting
  // on a ceiling is decided by jitter rather than by the code. Both reasons to
  // spend more samples are owned by lib/performanceBudgets.ts, which is pure
  // and unit-tested without a browser, so the budget sweep and the UX lane
  // report cannot drift apart on when a route is measured again. The extra
  // samples are spent ONLY where one of those two rules fired, so a quiet
  // sweep costs exactly what it did before.
  if (routeNeedsMoreEvidence(samples, route, method)) {
    for (let run = 0; run < (method.resampleRuns ?? 0); run += 1) {
      samples.push(await samplePerfRoute(page, route, method));
    }
  }
  return {
    samples,
    aggregate: {
      serverRenderMs: aggregatePerfMetric(samples.map((sample) => sample.serverRenderMs)),
      jsDecodedKB: aggregatePerfMetric(samples.map((sample) => sample.jsDecodedKB)),
      requests: aggregatePerfMetric(samples.map((sample) => sample.requests)),
      lcpMs: aggregatePerfMetric(samples.map((sample) => sample.lcpMs)),
      cls: aggregatePerfMetric(samples.map((sample) => sample.cls)),
      // A route whose gate held on every sample reports the page clock. One
      // fallback sample makes the whole route's figures indicative.
      boundarySource: samples.every((sample) => sample.boundarySource === "page-ready")
        ? "page-ready"
        : "harness-ready",
      stillOpen: [...new Set(samples.flatMap((sample) => sample.stillOpen))],
    },
  };
}
