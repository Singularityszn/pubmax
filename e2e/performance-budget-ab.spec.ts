import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { test, type Browser, type Page } from "@playwright/test";

import {
  abArmOrder,
  compareArms,
  formatAbScopeLines,
  formatAbTable,
  formatAbVerdictLines,
  selectAbBreaches,
  type AbBreach,
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

  // THE CAP, AND WHY IT IS NOT A TRUNCATION. A mass breach is the signature of
  // a slow box, and measuring forty routes twice walks this job into its wall,
  // where GitHub cancels the upload step and the evidence is lost in exactly
  // the case it exists for. The worst breaches are measured first and the
  // report says how many breached before it says how many were measured.
  const selection = selectAbBreaches(handover.breaches);
  const metricsByRoute = breachedMetricsByRoute(selection.breaches);
  const budgetedByPath = new Map(budgets.routes.map((route) => [route.path, route]));
  const routes = [...metricsByRoute.keys()]
    .map((path) => budgetedByPath.get(path))
    .filter((route): route is RouteBudget => route !== undefined);

  // The worst case for THESE routes, doubled because two arms take it. Reading
  // every budgeted route here would put the timeout hours past the job's own
  // wall, so a stuck arm would burn the whole job instead of failing its test
  // and leaving time for the artifact.
  test.setTimeout(60_000 * 2 * plannedNavigations(routes, budgets.method));

  const branch = await openArm(browser, "branch", branchOrigin, routes);
  const base = await openArm(browser, "base", baseOrigin, routes);

  const pairs: AbRoutePair[] = [];
  for (const route of routes) {
    const plan = resolveRouteRunPlan(route, budgets.method);
    await warmArm(branch, route, plan.warmupRuns);
    await warmArm(base, route, plan.warmupRuns);

    const arms: Record<Arm["name"], Arm> = { branch, base };
    const samples = { branch: [] as PerfSample[], base: [] as PerfSample[] };
    for (let run = 0; run < budgets.method.measuredRuns; run += 1) {
      // A, B, then B, A, then A, B. The rule itself lives in the pure module,
      // so it is unit-tested with no browser.
      for (const name of abArmOrder(run)) {
        samples[name].push(await sampleArm(arms[name], route));
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
    ...formatAbScopeLines(selection).map((line) => `[perf-ab] ${line}`),
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
