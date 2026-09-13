import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { test, type Browser, type Page } from "@playwright/test";

import {
  abArmOrder,
  abDeadlineReached,
  abMeasuringDeadlineMs,
  abNavigationAllowanceMs,
  abRouteFitsDeadline,
  abSamplesPerArm,
  abTimeoutMs,
  abWorkUnitsForRoute,
  compareArms,
  formatAbReport,
  selectAbBreaches,
  type AbBreach,
  type AbBreachHandover,
  type AbRoutePair,
} from "../lib/performanceAbEvidence";
import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  resolveRouteRunPlan,
  type BudgetMetric,
  type RouteBudget,
} from "../lib/performanceBudgets";
import {
  ROUTE_READY_TIMEOUT_MS,
  loadPerfRoute,
  measurePerfRedirect,
  preparePerfPage,
  resetPerfState,
  samplePerfRoute,
  waitForQuietNetwork,
  type PerfSample,
} from "./helpers/perfMeasurement";

// TELLING A RED ROUTE APART FROM A SLOW BOX, IN THE JOB THAT WENT RED.
//
// e2e/performance-budget.spec.ts is the gate and stays the gate: a route past
// its ceiling fails the build there, and no ceiling is read, moved or excused
// here. This spec answers the other question, the one an author cannot answer
// from a breach table alone - whether the BRANCH made the route slower, or
// whether this box is slower than the box that set the ceiling.
//
// It runs only on the routes the sweep breached, only after the sweep went red,
// and against a build of the MERGE BASE that the same job built on the same
// machine. Two figures taken on two different boxes are not comparable, which
// is the whole reason the evidence has to be gathered here rather than read off
// an older run's log.
//
// WHY THE NAVIGATIONS INTERLEAVE, A, B, A, B, AND NEVER ALL OF A THEN ALL OF B.
// A shared CI box drifts while a run is on it: another tenant's job starts, a
// core is taken away, a thermal ceiling arrives. Measure the whole branch arm
// and then the whole base arm and every bit of that drift lands on one side of
// the comparison, so the report becomes a measurement of the drift wearing the
// branch's name. Interleaved, the drift falls across both arms in the same
// proportion and cancels in the difference. The pair ALTERNATES which arm goes
// first, because a drift that only ever moves one way would otherwise settle on
// whichever arm is always second.
//
// Gated on PUBMAX_PERF_AB, and driven by scripts/perf-ab.mjs, which owns the
// merge-base worktree, the second build and both servers.

const budgets = PERFORMANCE_BUDGETS;
const branchOrigin = process.env.PUBMAX_PERF_AB_BRANCH_URL ?? "";
const baseOrigin = process.env.PUBMAX_PERF_AB_BASE_URL ?? "";
const reportPath = process.env.PUBMAX_PERF_AB_REPORT ?? "";

type Arm = { name: "branch" | "base"; origin: string; page: Page };

// WHERE THE BREACH LIST IS READ FROM, AND WHY IT IS NEVER THE SWEEP'S OWN PATH.
// The sweep writes `test-results/perf-budget-breaches.json`, and Playwright
// CLEARS `test-results/` at the START of every run - including this one, which
// is a second Playwright run in the same job, so that file is already gone by
// the time this line runs. scripts/perf-ab.mjs takes its own copy before it
// starts this spec and names it in PUBMAX_PERF_AB_BREACHES, which is the only
// place this spec reads.
function readBreaches(handoverPath: string): AbBreachHandover | null {
  try {
    return JSON.parse(readFileSync(handoverPath, "utf8")) as AbBreachHandover;
  } catch {
    return null;
  }
}

/** The breached metrics per route, each route's metrics in budget-file order. */
function breachedMetricsByRoute(breaches: readonly AbBreach[]): Map<string, BudgetMetric[]> {
  const byRoute = new Map<string, BudgetMetric[]>();
  for (const breach of breaches) {
    const metrics = byRoute.get(breach.path) ?? [];
    if (!metrics.includes(breach.metric)) metrics.push(breach.metric);
    byRoute.set(breach.path, metrics);
  }
  for (const [path, metrics] of byRoute) {
    byRoute.set(
      path,
      BUDGET_METRICS.filter((metric) => metrics.includes(metric)),
    );
  }
  return byRoute;
}

async function openArm(
  browser: Browser,
  name: Arm["name"],
  origin: string,
  routes: readonly RouteBudget[],
): Promise<Arm> {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  // EVERY NAVIGATION IS BOUND AT ITS OWN ALLOWANCE, which the config leaves
  // unbounded. A server that stalls without closing its socket hangs one
  // `page.goto` for as long as the whole test is allowed, which is the job's
  // wall and the upload with it. Bounded, that load fails its sample, the arm
  // reads NOT COMPARED, and the run carries on and still reports. It is set on
  // the A/B's own pages, so the sweep's method is untouched.
  page.setDefaultNavigationTimeout(abNavigationAllowanceMs(budgets.method, ROUTE_READY_TIMEOUT_MS));
  // The SAME preparation on both arms: the same viewport, the same CPU
  // throttle, the same network profile, the same third-party block and the same
  // in-page readiness gate. An arm prepared differently is not an arm.
  await preparePerfPage(page, origin, budgets.method, routes);
  return { name, origin, page };
}

/** One measured load, or a sample of NaNs when the route would not answer at all. */
async function sampleArm(arm: Arm, route: RouteBudget): Promise<PerfSample> {
  try {
    if (route.redirectsTo) {
      return await measurePerfRedirect(arm.page, { ...route, redirectsTo: route.redirectsTo });
    }
    return await samplePerfRoute(arm.page, route, budgets.method);
  } catch (error) {
    // A route this arm could not measure is reported as NOT COMPARED rather
    // than as a win for the other arm. An arm that failed proves nothing.
    console.log(
      `[perf-ab] ${arm.name} could not measure ${route.path}: ${(error as Error).message}`,
    );
    return {
      serverRenderMs: Number.NaN,
      jsDecodedKB: Number.NaN,
      requests: Number.NaN,
      lcpMs: Number.NaN,
      cls: Number.NaN,
      boundarySource: "harness-ready",
      stillOpen: [],
    };
  }
}

/**
 * The warm-ups this arm really performed, and whether the deadline stopped it.
 *
 * The deadline is asked before EVERY warm-up load, not only before the counted
 * samples: a route is admitted on the pace this run has observed, the first one
 * is admitted with no pace to go on at all, and four warm-up navigations spent
 * without asking can outlast the stop by minutes and take the upload with them.
 */
async function warmArm(
  arm: Arm,
  route: RouteBudget,
  warmupRuns: number,
  deadlinePassed: () => boolean,
): Promise<{ loads: number; stopped: boolean }> {
  await resetPerfState(arm.page);
  // A redirect is measured with one request rather than a page load, so it
  // warms nothing and must not be charged for loads it never made: the pace
  // those phantom navigations imply would admit the next route however little
  // time is left.
  if (route.redirectsTo) return { loads: 0, stopped: false };
  let loads = 0;
  for (let run = 0; run < warmupRuns; run += 1) {
    if (deadlinePassed()) return { loads, stopped: true };
    try {
      await loadPerfRoute(arm.page, route);
      await waitForQuietNetwork(arm.page, budgets.method);
      loads += 1;
    } catch {
      // A warm-up that failed is not a measurement. The counted samples below
      // report the failure if the route really cannot answer on this arm.
      return { loads, stopped: false };
    }
  }
  return { loads, stopped: false };
}

// A MEASUREMENT THAT IS RETRIED IS NOT A MEASUREMENT, the same declaration the
// sweep makes for the same reason. A second pass would re-measure both arms
// against the job's wall and overwrite the first pass's report with the second
// draw, which is the coin flip the sweep already refuses.
test.describe.configure({ retries: 0 });

test("a breached route is measured against its merge base on this box", async ({ browser }) => {
  test.skip(!process.env.PUBMAX_PERF_AB, "Owned by the Performance budget CI job.");

  // A green sweep never reaches here: scripts/perf-ab.mjs reads the same breach
  // list first and stops before it builds anything, which is what keeps the
  // second build off the critical path. So an EMPTY list at this point is a
  // broken invocation rather than a quiet pass, and it is refused rather than
  // skipped: a skipped lane is a lane nobody proves.
  const handoverPath = process.env.PUBMAX_PERF_AB_BREACHES ?? "";
  const handover = handoverPath ? readBreaches(handoverPath) : null;
  if (!handover || handover.breaches.length === 0) {
    throw new Error(
      "The A/B was asked to run with no breach list in PUBMAX_PERF_AB_BREACHES " +
        `(${handoverPath || "unset"}). It is driven by scripts/perf-ab.mjs, which copies the ` +
        "sweep's list out of test-results before this run clears that directory, and only " +
        "runs this spec on a red sweep.",
    );
  }
  if (!branchOrigin || !baseOrigin) {
    throw new Error(
      "The A/B needs both arms: PUBMAX_PERF_AB_BRANCH_URL and PUBMAX_PERF_AB_BASE_URL. " +
        "One arm is not a comparison.",
    );
  }

  // THE BUDGET, AND WHY IT IS NOT A TRUNCATION. A mass breach is the signature
  // of a slow box, and measuring forty routes twice walks this job into its
  // wall, where GitHub cancels the upload step and the evidence is lost in
  // exactly the case it exists for. The worst routes are measured first, a
  // route is measured only when its whole plan fits, and the report names what
  // the budget could not reach.
  const selection = selectAbBreaches(handover.breaches, budgets.routes, budgets.method);
  // The sweep's own figure per route and metric. Runner drift is a fact about
  // THAT figure rather than about anything the A/B measures later.
  const sweptFigure = new Map(
    handover.breaches.map((breach) => [`${breach.path} ${breach.metric}`, breach.measured]),
  );
  const metricsByRoute = breachedMetricsByRoute(selection.breaches);
  const budgetedByPath = new Map(budgets.routes.map((route) => [route.path, route]));
  const routes = [...metricsByRoute.keys()]
    .map((path) => budgetedByPath.get(path))
    .filter((route): route is RouteBudget => route !== undefined);

  test.setTimeout(abTimeoutMs(selection.navigations, budgets.method, ROUTE_READY_TIMEOUT_MS));

  const branch = await openArm(browser, "branch", branchOrigin, routes);
  const base = await openArm(browser, "base", baseOrigin, routes);

  const pairs: AbRoutePair[] = [];
  let routesMeasured = 0;

  // THE MEASURING CARRIES ITS OWN WALL-CLOCK DEADLINE, a share of the job's
  // wall owned by the pure module. Playwright's own timeout allows each
  // navigation what the harness allows it, which is right for one navigation
  // and cannot bound the run: a run bounded only by the job's wall is a run
  // GitHub cancels, and a cancelled job never reaches the step that uploads
  // this report.
  // THE DEADLINE IS WHAT IS LEFT OF THE JOB'S WALL, not a share of a wall the
  // sweep and the merge-base build may already have spent. scripts/perf-ab.mjs
  // passes the job's own start and its wall ONLY when the job handed it one;
  // with neither, this is a hand run racing no wall at all, so it measures
  // unbounded rather than against a wall nobody set.
  const jobWallMs = Number(process.env.PUBMAX_PERF_AB_JOB_WALL_MS) || 0;
  const jobStartedMs = Number(process.env.PUBMAX_PERF_AB_JOB_STARTED_MS) || 0;
  const deadlineMs =
    jobWallMs > 0 && jobStartedMs > 0
      ? abMeasuringDeadlineMs({
          elapsedMs: Date.now() - jobStartedMs,
          method: budgets.method,
          routeReadyTimeoutMs: ROUTE_READY_TIMEOUT_MS,
          jobWallMs,
        })
      : Number.POSITIVE_INFINITY;
  const startedAt = Date.now();
  const deadlineNotStarted: string[] = [];
  const deadlineStoppedPartWay: string[] = [];
  let navigationsSpent = 0;
  let workSpent = 0;

  // THE REPORT IS WRITTEN AFTER EVERY ROUTE, NOT ONCE AT THE END. The box slow
  // enough to abort this run is the box whose evidence matters most, and the
  // selection is ordered worst first precisely so a run cut short has already
  // measured the routes an author asks about. A report assembled only after the
  // last route throws all of that away.
  const writeReport = (): string => {
    const report = formatAbReport({
      branchOrigin,
      baseOrigin,
      head: handover.head,
      selection,
      rows: compareArms(pairs, budgets.method),
      routesMeasured,
      routesSelected: routes.length,
      navigationsSpent,
      deadlineNotStarted,
      deadlineStoppedPartWay,
      deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : undefined,
    });
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${report}\n`);
    }
    return report;
  };

  for (const route of routes) {
    // NEVER BEGIN WHAT CANNOT FINISH. A route started with less time left than
    // its own plan costs spends that time and still hands over NOT COMPARED.
    // The price is this run's own measured pace, so the check describes the box
    // it is running on rather than a figure typed beside it.
    // The pace comes from WORK DONE rather than navigations spent. A redirect
    // makes no navigation, so pricing the pace off navigations left the run in
    // its first-route state for as long as redirects kept coming and admitted
    // the route after one however little time remained.
    const fits = abRouteFitsDeadline({
      workUnits: abWorkUnitsForRoute(route, budgets.method),
      remainingMs: deadlineMs - (Date.now() - startedAt),
      observedMsPerWorkUnit: workSpent > 0 ? (Date.now() - startedAt) / workSpent : null,
    });
    if (!fits) {
      deadlineNotStarted.push(route.path);
      continue;
    }

    const plan = resolveRouteRunPlan(route, budgets.method);
    const deadlinePassed = () => abDeadlineReached(startedAt, Date.now(), deadlineMs);
    let stoppedMidRoute = false;
    for (const arm of [branch, base]) {
      const warmed = await warmArm(arm, route, plan.warmupRuns, deadlinePassed);
      navigationsSpent += warmed.loads;
      workSpent += warmed.loads;
      if (warmed.stopped) stoppedMidRoute = true;
    }

    const arms: Record<Arm["name"], Arm> = { branch, base };
    const samples = { branch: [] as PerfSample[], base: [] as PerfSample[] };
    // The route's OWN plan on both arms: a marked route is judged on the median
    // of seven here exactly as the sweep judges it, because three samples cannot
    // decide a route whose samples were recorded 37 to 51 per cent apart.
    const countedRuns = abSamplesPerArm(route, budgets.method);
    for (let run = 0; run < countedRuns && !stoppedMidRoute; run += 1) {
      // A, B, then B, A, then A, B. The rule itself lives in the pure module,
      // so it is unit-tested with no browser.
      for (const name of abArmOrder(run)) {
        // Belt and braces for a route running slower than its plan predicted:
        // the run stops here, the route keeps fewer samples than it planned,
        // and the rule already in force reads that as NOT COMPARED.
        if (deadlinePassed()) {
          stoppedMidRoute = true;
          break;
        }
        samples[name].push(await sampleArm(arms[name], route));
        // A redirect is measured with one request rather than a page load, so
        // it is not charged as a navigation: six near-free entries would price
        // the whole run below what a real load costs and admit a route whose
        // plan cannot finish.
        if (!route.redirectsTo) navigationsSpent += 1;
        workSpent += 1;
      }
    }

    for (const metric of metricsByRoute.get(route.path) ?? []) {
      pairs.push({
        path: route.path,
        metric,
        budget: route[metric],
        sweepMeasured: sweptFigure.get(`${route.path} ${metric}`) ?? Number.NaN,
        branch: samples.branch.map((sample) => sample[metric]),
        base: samples.base.map((sample) => sample[metric]),
        plannedSamples: countedRuns,
      });
    }
    if (stoppedMidRoute) deadlineStoppedPartWay.push(route.path);
    else routesMeasured += 1;
    writeReport();
  }

  // THE LAST WRITE COMES BEFORE THE TEARDOWN. It is the only one that records
  // the routes the deadline never started, and on a run whose deadline was
  // spent before the first route it is the only write at all, so it must not
  // sit behind two closes that nothing bounds.
  const report = writeReport();
  await branch.page.context().close();
  await base.page.context().close();

  console.log(report);
});
