import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  findBudgetBreaches,
  formatBreachTable,
  median,
  medianSitsOnTheLine,
  plannedNavigations,
  resolveRouteRunPlan,
  routeNeedsMoreEvidence,
  samplesDisagree,
  type BudgetMethod,
  type BudgetMetric,
  type RouteBudget,
  type RouteMeasurement,
  type SampleRow,
} from "@/lib/performanceBudgets";

// The budget's own fence. The measuring runs in a browser (e2e/performance
// -budget.spec.ts), so the RULES are pinned here where they cost nothing:
// a budget that is missing, unreadable or silently unenforced is the same as
// no budget at all, and that is the failure this file exists to catch.

const route = (over: Partial<RouteBudget> = {}): RouteBudget => ({
  path: "/x",
  readySelector: "main",
  why: "because",
  serverRenderMs: 100,
  jsDecodedKB: 1000,
  requests: 50,
  lcpMs: 2000,
  ...over,
});

const measurement = (over: Partial<RouteMeasurement> = {}): RouteMeasurement => ({
  serverRenderMs: 10,
  jsDecodedKB: 100,
  requests: 5,
  lcpMs: 200,
  ...over,
});

describe("perf/route-budgets.json", () => {
  it("budgets the routes the product is judged on", () => {
    const paths = PERFORMANCE_BUDGETS.routes.map((entry) => entry.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/map");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every route a real ceiling on every metric and a reason to be listed", () => {
    for (const entry of PERFORMANCE_BUDGETS.routes) {
      expect(entry.path.startsWith("/"), entry.path).toBe(true);
      expect(entry.readySelector.length, entry.path).toBeGreaterThan(0);
      expect(entry.why.trim().length, entry.path).toBeGreaterThan(0);
      for (const metric of BUDGET_METRICS) {
        expect(Number.isFinite(entry[metric]), `${entry.path} ${metric}`).toBe(true);
        expect(entry[metric], `${entry.path} ${metric}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the method honest: a warm-up, a real three-sample median", () => {
    const { method } = PERFORMANCE_BUDGETS;
    expect(method.warmupRuns).toBeGreaterThanOrEqual(1);
    expect(method.measuredRuns).toBe(3);
    expect(method.aggregate).toBe("median");
    expect(method.thirdPartyBlocked).toBe(true);
  });

  it("says in the config where counting stops, because that is what makes two runs comparable", () => {
    expect(PERFORMANCE_BUDGETS.method.countedUpTo.trim().length).toBeGreaterThan(0);
  });
});

describe("findBudgetBreaches", () => {
  it("passes a run that is inside every ceiling", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement()]]),
    );
    expect(breaches).toEqual([]);
  });

  it("treats the ceiling itself as inside the budget", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ serverRenderMs: 100 })]]),
    );
    expect(breaches).toEqual([]);
  });

  it("names the metric, the figure and how far past it went", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ jsDecodedKB: 1500 })]]),
    );
    expect(breaches).toEqual([
      { path: "/x", metric: "jsDecodedKB", measured: 1500, budget: 1000, overBy: 50 },
    ]);
  });

  it("fails a metric that was not measured", () => {
    const breaches = findBudgetBreaches(
      [route()],
      new Map([["/x", measurement({ lcpMs: Number.NaN })]]),
    );

    expect(breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
    expect(Number.isNaN(breaches[0].measured)).toBe(true);
  });

  it("fails a route nobody measured rather than reading silence as a pass", () => {
    const breaches = findBudgetBreaches([route()], new Map());
    expect(breaches.map((breach) => breach.metric)).toEqual([...BUDGET_METRICS]);
    expect(breaches.every((breach) => Number.isNaN(breach.measured))).toBe(true);
  });
});

describe("formatBreachTable", () => {
  it("says nothing when nothing broke", () => {
    expect(formatBreachTable([])).toBe("");
  });

  it("prints one row per breach with the route, the figure and the ceiling", () => {
    const table = formatBreachTable(
      findBudgetBreaches(
        [route({ path: "/map" })],
        new Map([["/map", measurement({ serverRenderMs: 250, requests: 75 })]]),
      ),
    );
    expect(table).toContain("route");
    expect(table).toContain("/map");
    expect(table).toContain("server render (ms)");
    expect(table).toContain("250");
    expect(table).toContain("+150%");
    expect(table).toContain("+50%");
  });

  it("says a missing figure was not measured instead of printing NaN", () => {
    expect(formatBreachTable(findBudgetBreaches([route()], new Map()))).toContain(
      "not measured",
    );
  });
});

describe("median", () => {
  it("takes the middle of an odd sample and the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("has no answer for an empty sample", () => {
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

// THE RESAMPLE IS SYMMETRIC, and this is where that is held.
//
// The trigger buys extra samples where a verdict is decided by jitter. The
// first cut fired on any median at or above `ceiling * (1 - margin)`, a band
// with no upper edge, so it spent evidence on every breach and on nothing
// sitting comfortably under the line: a rescue budget rather than a
// measurement. The captain's decision (7 September 2026) is that the band be
// symmetric, so a figure just under and a figure just over buy the same
// evidence and a route far over its ceiling buys none.
describe("medianSitsOnTheLine", () => {
  // A margin of 10 per cent of a 300 ms ceiling is a 30 ms band either side.
  const method: BudgetMethod = {
    ...PERFORMANCE_BUDGETS.method,
    resampleRuns: 2,
    resampleWithinCeilingPct: 10,
  };
  const ceilings = { lcpMs: 300 };
  const at = (...lcps: number[]): SampleRow[] =>
    lcps.map((lcpMs) => ({ serverRenderMs: 0, jsDecodedKB: 0, requests: 0, lcpMs }));

  it("fires on a median just under the ceiling", () => {
    expect(medianSitsOnTheLine(at(280, 295, 298), ceilings, method)).toBe(true);
  });

  it("fires on a median just over the ceiling", () => {
    // The case PR #1611 went red on: /today at 364 against 300 is 21 per cent
    // over, so it is outside the band; 320 against 300 is inside it.
    expect(medianSitsOnTheLine(at(310, 320, 330), ceilings, method)).toBe(true);
  });

  it("does not fire on a median far under the ceiling", () => {
    expect(medianSitsOnTheLine(at(190, 200, 210), ceilings, method)).toBe(false);
  });

  it("does not fire on a median far over the ceiling, because that is a regression", () => {
    // The half the old one-sided band got wrong: it bought a rescue attempt for
    // a route three times over its ceiling. The spread rule is still there for
    // the run where the box genuinely stalled.
    expect(medianSitsOnTheLine(at(880, 900, 920), ceilings, method)).toBe(false);
    expect(samplesDisagree(at(880, 900, 920), method)).toBe(false);
  });

  it("is symmetric: equal distances either side of the ceiling answer the same", () => {
    for (const distance of [0, 10, 30, 31, 60]) {
      expect(
        medianSitsOnTheLine(at(300 - distance), ceilings, method),
        `${distance} ms under`,
      ).toBe(medianSitsOnTheLine(at(300 + distance), ceilings, method));
    }
  });

  it("asks nothing of a metric the route carries no ceiling for", () => {
    expect(medianSitsOnTheLine(at(300), {}, method)).toBe(false);
  });

  it("spends nothing when the route has no resample budget to spend", () => {
    expect(routeNeedsMoreEvidence(at(300), ceilings, method, 0)).toBe(false);
    expect(routeNeedsMoreEvidence(at(300), ceilings, method, 2)).toBe(true);
  });

  it("still buys evidence for samples that disagree far under the ceiling", () => {
    // Symmetry narrows the on-the-line band; it must not take the spread rule
    // with it, or a route that could not measure itself would be judged on the
    // disagreement.
    const wild = at(20, 200, 900);
    expect(medianSitsOnTheLine(wild, ceilings, method)).toBe(false);
    expect(samplesDisagree(wild, method)).toBe(true);
    expect(routeNeedsMoreEvidence(wild, ceilings, method, 2)).toBe(true);
  });
});

// THE NOISE FLOOR, and the two things it may never do: move a ceiling, or cost
// an unmarked route anything.
describe("resolveRouteRunPlan", () => {
  const method: BudgetMethod = {
    ...PERFORMANCE_BUDGETS.method,
    warmupRuns: 1,
    measuredRuns: 3,
    resampleRuns: 2,
    noisyWarmupRuns: 2,
    noisyResampleRuns: 4,
  };
  const mark = { metrics: ["lcpMs"] as const, measuredSpreadPct: 51, why: "measured wide" };

  it("leaves an unmarked route on exactly the runs it took before", () => {
    expect(resolveRouteRunPlan({}, method)).toEqual({
      warmupRuns: 1,
      resampleRuns: 2,
      noisy: false,
    });
  });

  it("gives a marked route a second discarded warm-up and a median of seven", () => {
    const plan = resolveRouteRunPlan({ noisy: { ...mark, metrics: ["lcpMs"] } }, method);
    expect(plan).toEqual({ warmupRuns: 2, resampleRuns: 4, noisy: true });
    expect(method.measuredRuns + plan.resampleRuns).toBe(7);
  });

  it("falls back to the ordinary budget when the method declares no floor", () => {
    const noFloor: BudgetMethod = {
      ...method,
      noisyWarmupRuns: undefined,
      noisyResampleRuns: undefined,
    };
    expect(resolveRouteRunPlan({ noisy: { ...mark, metrics: ["lcpMs"] } }, noFloor)).toEqual({
      warmupRuns: 1,
      resampleRuns: 2,
      noisy: true,
    });
  });

  it("counts the worst case a sweep can cost, so its timeout is not a guess", () => {
    const routes = [{}, { noisy: { ...mark, metrics: ["lcpMs"] as BudgetMetric[] } }];
    // 1 + 3 + 2 for the quiet route, 2 + 3 + 4 for the marked one.
    expect(plannedNavigations(routes, method)).toBe(15);
  });
});

describe("the routes the budget file marks noisy", () => {
  const marked = PERFORMANCE_BUDGETS.routes.filter((entry) => entry.noisy);

  it("declares the noise floor it spends", () => {
    const { method } = PERFORMANCE_BUDGETS;
    expect(method.noisyWarmupRuns).toBeGreaterThan(method.warmupRuns);
    expect(method.noisyResampleRuns).toBeGreaterThan(method.resampleRuns ?? 0);
    expect((method.noisyFloorWhy ?? "").trim().length).toBeGreaterThan(20);
  });

  it("records the evidence for every mark, so it can be argued with and taken off", () => {
    expect(marked.length).toBeGreaterThan(0);
    for (const entry of marked) {
      const noisy = entry.noisy!;
      expect(noisy.metrics.length, entry.path).toBeGreaterThan(0);
      for (const metric of noisy.metrics) {
        expect(BUDGET_METRICS, `${entry.path} ${metric}`).toContain(metric);
      }
      expect(noisy.measuredSpreadPct, entry.path).toBeGreaterThan(
        PERFORMANCE_BUDGETS.method.sampleSpreadWarnPct,
      );
      expect(noisy.why.trim().length, entry.path).toBeGreaterThan(40);
    }
  });

  it("is a marking and never a ceiling, so no marked route pays for it in headroom", () => {
    // The whole point of the floor: more evidence, never a bigger number. If a
    // mark ever arrives in the same commit as a raise on the same metric, this
    // says so.
    for (const entry of marked) {
      for (const raise of entry.ceilingRaises ?? []) {
        expect(
          entry.noisy!.metrics.includes(raise.metric) && raise.why.includes("noisy"),
          `${entry.path} ${raise.metric}`,
        ).toBe(false);
      }
    }
  });
});

// A ROUTE THAT REDIRECTS IS MEASURED AS A REDIRECT, NEVER AS ITS TARGET.
//
// The sweep opens each route with `waitUntil: "load"`, and a browser follows a
// 3xx, so the moment a budgeted route starts redirecting its row silently
// measures somebody else's page under its own ceiling. That is not theory:
// /onboarding now answers 307 to "/" and ships no document (Astra's live walk,
// finding B6), and the next sweep read the HOMEPAGE'S 45 requests against the
// 41 that used to buy an almost empty first-run shell. Nothing had got slower.
// The row had stopped naming a route.
//
// Reading it as a regression would have taken the ceiling up to hide a
// measurement pointing at the wrong page, and reading it as a win would have
// let any route lose its own ceiling by learning to redirect.
describe("a budgeted route that redirects", () => {
  const redirecting = PERFORMANCE_BUDGETS.routes.filter((entry) => entry.redirectsTo);

  it("is declared, so the sweep can tell it from a page", () => {
    const onboarding = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === "/onboarding");
    expect(onboarding?.redirectsTo).toBe("/");
  });

  it("sends the reader to a path that carries a ceiling of its own", () => {
    // Otherwise the target's cost leaves the budget entirely: the redirect is
    // cheap, and the page it lands on is measured by nobody.
    const budgeted = new Set(PERFORMANCE_BUDGETS.routes.map((entry) => entry.path));
    for (const entry of redirecting) {
      expect(budgeted.has(entry.redirectsTo!), `${entry.path} -> ${entry.redirectsTo}`).toBe(true);
    }
  });

  it("is budgeted for the redirect it serves, not the page it points at", () => {
    for (const entry of redirecting) {
      const target = PERFORMANCE_BUDGETS.routes.find((row) => row.path === entry.redirectsTo);
      expect(entry.requests, `${entry.path} requests`).toBeLessThanOrEqual(1);
      expect(entry.jsDecodedKB, `${entry.path} jsDecodedKB`).toBe(0);
      expect(entry.lcpMs, `${entry.path} lcpMs`).toBe(0);
      // A redirect that costs what the page costs is the row still measuring
      // the page.
      expect(entry.requests, `${entry.path} against ${target?.path}`).toBeLessThan(
        target?.requests ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("is measured through the redirect lane, never through the page loader", () => {
    const spec = readFileSync(join(process.cwd(), "e2e/performance-budget.spec.ts"), "utf8");
    expect(spec).toContain("redirectsTo");
    expect(spec).toContain("measurePerfRedirect");
  });

  it("still fails the ordinary way when the redirect costs more than its ceiling", () => {
    const breaches = findBudgetBreaches(
      [route({ path: "/gone", redirectsTo: "/", requests: 1, jsDecodedKB: 0, lcpMs: 0 })],
      new Map([["/gone", measurement({ requests: 8, jsDecodedKB: 0, lcpMs: 0 })]]),
    );
    expect(breaches.map((breach) => breach.metric)).toContain("requests");
  });
});

