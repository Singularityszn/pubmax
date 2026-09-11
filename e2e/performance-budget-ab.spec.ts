import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { test, type Browser, type Page } from "@playwright/test";

import {
  PERF_AB_BREACH_FILE,
  compareArms,
  formatAbTable,
  formatAbVerdictLines,
  type AbBreachHandover,
  type AbRoutePair,
} from "../lib/performanceAbEvidence";
import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  plannedNavigations,
  resolveRouteRunPlan,
  type BudgetMetric,
  type RouteBudget,
} from "../lib/performanceBudgets";
import {
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

function readBreaches(): AbBreachHandover | null {
  try {
    return JSON.parse(readFileSync(PERF_AB_BREACH_FILE, "utf8")) as AbBreachHandover;
  } catch {
    return null;
  }
}

/** The breached metrics per route, in budget-file order so the table reads like the sweep's. */
function breachedMetricsByRoute(handover: AbBreachHandover): Map<string, BudgetMetric[]> {
  const byRoute = new Map<string, BudgetMetric[]>();
  for (const breach of handover.breaches) {
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

async function warmArm(arm: Arm, route: RouteBudget, warmupRuns: number): Promise<void> {
  await resetPerfState(arm.page);
  if (route.redirectsTo) return;
  for (let run = 0; run < warmupRuns; run += 1) {
    try {
      await loadPerfRoute(arm.page, route);
      await waitForQuietNetwork(arm.page, budgets.method);
    } catch {
      // A warm-up that failed is not a measurement. The counted samples below
      // report the failure if the route really cannot answer on this arm.
      return;
    }
  }
}

// The same worst case the sweep's own timeout reads, doubled because two arms
// take it. A timeout that did not count both arms would time the A/B out on the
// evidence it exists to gather.
const AB_TIMEOUT_MS = 60_000 * 2 * plannedNavigations(budgets.routes, budgets.method);

test("a breached route is measured against its merge base on this box", async ({ browser }) => {
  test.skip(!process.env.PUBMAX_PERF_AB, "Owned by the Performance budget CI job.");
  test.setTimeout(AB_TIMEOUT_MS);

  // A green sweep never reaches here: scripts/perf-ab.mjs reads the same breach
  // list first and stops before it builds anything, which is what keeps the
  // second build off the critical path. So an EMPTY list at this point is a
  // broken invocation rather than a quiet pass, and it is refused rather than
  // skipped: a skipped lane is a lane nobody proves.
  const handover = readBreaches();
  if (!handover || handover.breaches.length === 0) {
    throw new Error(
      `The A/B was asked to run with no breach list at ${PERF_AB_BREACH_FILE}. ` +
        "It is driven by scripts/perf-ab.mjs, which only runs it on a red sweep.",
    );
  }
  if (!branchOrigin || !baseOrigin) {
    throw new Error(
      "The A/B needs both arms: PUBMAX_PERF_AB_BRANCH_URL and PUBMAX_PERF_AB_BASE_URL. " +
        "One arm is not a comparison.",
    );
  }

  const metricsByRoute = breachedMetricsByRoute(handover);
  const routes = budgets.routes.filter((route) => metricsByRoute.has(route.path));

  const branch = await openArm(browser, "branch", branchOrigin, routes);
  const base = await openArm(browser, "base", baseOrigin, routes);

  const pairs: AbRoutePair[] = [];
  for (const route of routes) {
    const plan = resolveRouteRunPlan(route, budgets.method);
    await warmArm(branch, route, plan.warmupRuns);
    await warmArm(base, route, plan.warmupRuns);

    const samples = { branch: [] as PerfSample[], base: [] as PerfSample[] };
    for (let run = 0; run < budgets.method.measuredRuns; run += 1) {
      // A, B, then B, A, then A, B: interleaved so drift during the run falls
      // on both arms, and alternated so a drift that only moves one way does
      // not settle on whichever arm is always second.
      const order: Arm[] = run % 2 === 0 ? [branch, base] : [base, branch];
      for (const arm of order) {
        samples[arm.name].push(await sampleArm(arm, route));
      }
    }

    for (const metric of metricsByRoute.get(route.path) ?? []) {
      pairs.push({
        path: route.path,
        metric,
        budget: route[metric],
        branch: samples.branch.map((sample) => sample[metric]),
        base: samples.base.map((sample) => sample[metric]),
      });
    }
  }

  await branch.page.context().close();
  await base.page.context().close();

  const rows = compareArms(pairs, budgets.method);
  const report = [
    "[perf-ab] the branch against its merge base: same box, same job, navigations interleaved",
    `[perf-ab] branch ${branchOrigin}  base ${baseOrigin}  head ${handover.head || "local"}`,
    "",
    formatAbTable(rows),
    "",
    ...formatAbVerdictLines(rows).map((line) => `  - ${line}`),
    "",
    "[perf-ab] This moves no ceiling and fails nothing: the breach table is still the gate.",
  ].join("\n");
  console.log(report);

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${report}\n`);
  }
});
