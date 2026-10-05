import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUDGET_METRICS,
  PERFORMANCE_BUDGETS,
  bankableRatchetCandidates,
  findBudgetBreaches,
  findRatchetCandidates,
  formatBreachTable,
  formatUnmeasuredTable,
  judgeBudgets,
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
import { defined } from "@/__tests__/helpers/defined";

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
        // A PAGE owes a positive ceiling on every metric. A route that answers
        // a redirect draws nothing and runs no script, so its honest ceiling on
        // those metrics is zero, and the shape it must keep instead is pinned
        // by "a budgeted route that redirects" below.
        if (entry.redirectsTo) continue;
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
    expect(Number.isNaN(defined(breaches[0]).measured)).toBe(true);
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


// A VERDICT IS UNANIMOUS OR IT IS NOT A VERDICT.
//
// The sweep already resampled, took the median and WARNED when a route's own
// samples sat further apart than the tracked width. The warning changed
// nothing: a route whose samples spread 133 per cent still failed on its
// median, so a loaded runner read as a breach. Two runs of job 103319591915 on
// the identical commit 3ebac98ac shared three of their eleven breached routes,
// and every route unique to one of them straddled its own ceiling.
//
// So the samples now decide whether their own median is a verdict at all: a
// clock whose samples disagree past `sampleSpreadWarnPct` and STRADDLE the
// ceiling did not measure that ceiling, and is reported unmeasured rather than
// failed. A run of which NOT ONE sample met the ceiling is over budget however
// wide it was, because every median that evidence allows is over: that is the
// half that keeps a genuinely slow route failing. A run entirely under its
// ceiling decided a pass the same way. The report reads both ways, so a
// straddling run is named whichever side its median fell on, and only the
// breach list is ever gated. Counts are never excused: see CLOCK_METRICS.
describe("judgeBudgets", () => {
  const method: BudgetMethod = { ...PERFORMANCE_BUDGETS.method, sampleSpreadWarnPct: 12 };
  const lcps = (...values: number[]): SampleRow[] =>
    values.map((lcpMs) => ({ serverRenderMs: 0, jsDecodedKB: 0, requests: 0, lcpMs }));
  const judge = (samples: SampleRow[], lcpMs = 300) =>
    judgeBudgets(
      [route({ lcpMs })],
      new Map([["/x", measurement({ lcpMs: median(samples.map((s) => s.lcpMs)) })]]),
      new Map([["/x", samples]]),
      method,
    );

  it("fails a route whose tight samples all sit over the ceiling", () => {
    const verdict = judge(lcps(392, 400, 408));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
    expect(defined(verdict.breaches[0]).measured).toBe(400);
  });

  it("reports a wide run that straddles its ceiling as unmeasured rather than breached", () => {
    // /choose-city, second run of 3ebac98ac: 62 per cent apart around a 300 ms
    // ceiling, and the first run of the same commit measured it 336.
    const verdict = judge(lcps(476, 336, 356, 408, 256));
    expect(verdict.breaches).toEqual([]);
    expect(verdict.unmeasured).toEqual([
      {
        path: "/x",
        metric: "lcpMs",
        budget: 300,
        median: 356,
        min: 256,
        max: 476,
        spreadPct: 62,
      },
    ]);
  });

  it("still fails a wide run in which no sample met the ceiling", () => {
    // Wide is not a licence. /today's first run of 3ebac98ac spread 103 per
    // cent, and its fastest of seven samples was 352 ms against a 300 ms
    // ceiling: not one of the seven ever met the line.
    const verdict = judge(lcps(392, 744, 480, 848, 680, 372, 352));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("fails a route three times over its ceiling however wide the run was", () => {
    // The case the rule may never launder: 400 to 1200 against 300 is a
    // regression, and no amount of spread makes its fastest sample innocent.
    const verdict = judge(lcps(400, 800, 1200));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("fails a median two thirds over its ceiling whose fastest sample only grazed it", () => {
    // The hole a band around the ceiling would have left: 320 is over a 300 ms
    // ceiling by less than the resample band, so a rule anchored on that band
    // excluded a median of 800. The anchor is the ceiling itself.
    const verdict = judge(lcps(320, 800, 1200));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
    expect(defined(verdict.breaches[0]).measured).toBe(800);
  });

  it("draws the line at the ceiling itself", () => {
    // A sample that met the 300 ms ceiling leaves the run undecided; a run
    // whose fastest sample missed it by one millisecond is a breach.
    expect(judge(lcps(300, 600, 900)).breaches).toEqual([]);
    expect(judge(lcps(300, 600, 900)).unmeasured).toHaveLength(1);
    expect(judge(lcps(301, 600, 900)).breaches).toHaveLength(1);
    expect(judge(lcps(301, 600, 900)).unmeasured).toEqual([]);
  });

  it("names a straddling run that passed as unmeasured too, and still passes it", () => {
    // Median 290 under a 300 ms ceiling off samples running 250 to 600. The
    // same evidence may not read as a clean pass on one side of a ceiling and
    // as undecided on the other, so it is named either way. Naming it fails
    // nothing: the gate reads the breach list alone.
    const verdict = judgeBudgets(
      [route({ lcpMs: 300 })],
      new Map([["/x", measurement({ lcpMs: 290 })]]),
      new Map([["/x", lcps(250, 260, 290, 500, 600)]]),
      method,
    );
    expect(verdict.breaches).toEqual([]);
    expect(verdict.unmeasured.map((entry) => entry.metric)).toEqual(["lcpMs"]);
    expect(defined(verdict.unmeasured[0]).median).toBe(290);
  });

  it("says nothing about a wide run that never reached its ceiling", () => {
    // /tonight, second run of 3ebac98ac: 133 per cent apart, and its SLOWEST
    // sample 588 ms against a 900 ms ceiling. Nothing about that run is in
    // doubt, and naming it would bury the straddling rows the table exists for.
    // Server render is the same shape on every route: 3 to 19 ms against 150.
    const verdict = judgeBudgets(
      [route({ lcpMs: 900 })],
      new Map([["/x", measurement({ lcpMs: 256 })]]),
      new Map([["/x", lcps(588, 304, 256, 256, 248)]]),
      method,
    );
    expect(verdict.breaches).toEqual([]);
    expect(verdict.unmeasured).toEqual([]);
  });

  it("fails a parked regression that one warm sample happened to straddle", () => {
    // Six of seven samples at 1200 ms against a 300 ms ceiling, with one warm
    // 290 ms sample. It straddles and it is wide, but the median is 900 ms over
    // the line against a half-spread of 455: noise that size did not put the
    // median there, so the excess does not fit inside the spread that is
    // supposed to explain it.
    const verdict = judge(lcps(290, 1200, 1200, 1200, 1200, 1200, 1200));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("draws the line at half the spread", () => {
    // Samples 300 to 900 give a half-spread of 300. A median 300 ms over the
    // ceiling is exactly what that much noise can account for; one millisecond
    // further over it is not.
    expect(judge(lcps(300, 600, 900)).unmeasured).toHaveLength(1);
    expect(judge(lcps(300, 601, 900)).unmeasured).toEqual([]);
    expect(judge(lcps(300, 601, 900)).breaches).toHaveLength(1);
  });

  it("never excuses a count, however wide and however it straddled", () => {
    // The hole a clock-shaped rule may not leave: an extra chunk on some
    // navigations reads as requests 44, 60 and 62 against a ceiling of 46. That
    // is a route doing different work rather than a loaded box, so the median
    // is judged and the sweep goes red.
    const samples: SampleRow[] = [44, 60, 62].map((requests) => ({
      serverRenderMs: 0,
      jsDecodedKB: 0,
      requests,
      lcpMs: 0,
    }));
    const verdict = judgeBudgets(
      [route({ requests: 46 })],
      new Map([["/x", measurement({ requests: 60 })]]),
      new Map([["/x", samples]]),
      method,
    );
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["requests"]);
    expect(defined(verdict.breaches[0]).measured).toBe(60);
  });

  it("fails a straddling run whose samples agreed, because that is the line rather than the noise", () => {
    // 4 per cent apart: the route really does sit on its ceiling, and a run
    // that agrees with itself has measured that.
    const verdict = judge(lcps(296, 304, 308));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("fails a route nobody measured, exactly as before", () => {
    const verdict = judgeBudgets([route()], new Map(), new Map(), method);
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual([...BUDGET_METRICS]);
  });

  it("fails a one-sample row, because one sample cannot disagree with itself", () => {
    // A route that answers a redirect is measured once, deterministically.
    const verdict = judge(lcps(420));
    expect(verdict.unmeasured).toEqual([]);
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["lcpMs"]);
  });

  it("judges each metric on its own samples", () => {
    const samples: SampleRow[] = [
      { serverRenderMs: 200, jsDecodedKB: 100, requests: 5, lcpMs: 100 },
      { serverRenderMs: 210, jsDecodedKB: 100, requests: 5, lcpMs: 900 },
      { serverRenderMs: 205, jsDecodedKB: 100, requests: 5, lcpMs: 500 },
    ];
    const verdict = judgeBudgets(
      [route({ serverRenderMs: 100, lcpMs: 300 })],
      new Map([["/x", measurement({ serverRenderMs: 205, lcpMs: 500 })]]),
      new Map([["/x", samples]]),
      method,
    );
    expect(verdict.breaches.map((breach) => breach.metric)).toEqual(["serverRenderMs"]);
    expect(verdict.unmeasured.map((entry) => entry.metric)).toEqual(["lcpMs"]);
  });
});

// A RUN MAY NOT REFUSE A MEDIAN AND BANK IT IN THE SAME LOG.
//
// The ratchet table names ceilings with slack worth taking down. A metric this
// run could not decide has no slack worth taking down: the fast samples that
// made its median look generous are the next sweep's red, and lowering the
// ceiling off them recreates the flake this change fixes.
describe("bankableRatchetCandidates", () => {
  const method: BudgetMethod = { ...PERFORMANCE_BUDGETS.method, sampleSpreadWarnPct: 12 };
  const budgets = [route({ lcpMs: 900, serverRenderMs: 150 })];
  const measured = new Map([["/x", measurement({ lcpMs: 115, serverRenderMs: 10 })]]);
  const samples: SampleRow[] = [100, 110, 120, 1000].map((lcpMs) => ({
    serverRenderMs: 10,
    jsDecodedKB: 100,
    requests: 5,
    lcpMs,
  }));

  it("drops a metric this run could not decide, and keeps the rest", () => {
    const { unmeasured } = judgeBudgets(budgets, measured, new Map([["/x", samples]]), method);
    expect(unmeasured.map((entry) => entry.metric)).toEqual(["lcpMs"]);
    const candidates = findRatchetCandidates(budgets, measured);
    expect(candidates.map((candidate) => candidate.metric)).toContain("lcpMs");
    const bankable = bankableRatchetCandidates(candidates, unmeasured);
    expect(bankable.map((candidate) => candidate.metric)).not.toContain("lcpMs");
    expect(bankable.map((candidate) => candidate.metric)).toContain("serverRenderMs");
  });

  it("drops a straddling row whose median reads as slack worth banking", () => {
    // The shape the guard exists for: LCP 200, 250 and 1000 ms against a 300 ms
    // ceiling. The run could not decide the ceiling, and the same median offers
    // 17 per cent of slack. Bank it and the 1000 ms sample is the next red.
    const straddling = [route({ lcpMs: 300 })];
    const measuredHere = new Map([["/x", measurement({ lcpMs: 250 })]]);
    const rows: SampleRow[] = [200, 250, 1000].map((lcpMs) => ({
      serverRenderMs: 10,
      jsDecodedKB: 100,
      requests: 5,
      lcpMs,
    }));
    const { unmeasured } = judgeBudgets(
      straddling,
      measuredHere,
      new Map([["/x", rows]]),
      method,
    );
    expect(unmeasured.map((entry) => entry.metric)).toContain("lcpMs");
    const candidates = findRatchetCandidates(straddling, measuredHere);
    expect(candidates.map((candidate) => candidate.metric)).toContain("lcpMs");
    expect(
      bankableRatchetCandidates(candidates, unmeasured).map((candidate) => candidate.metric),
    ).not.toContain("lcpMs");
  });

  it("offers every candidate when the run decided every ceiling", () => {
    const candidates = findRatchetCandidates(budgets, measured);
    expect(bankableRatchetCandidates(candidates, [])).toEqual(candidates);
  });
});

describe("formatUnmeasuredTable", () => {
  it("is empty when every figure decided itself", () => {
    expect(formatUnmeasuredTable([])).toBe("");
  });

  it("names the route, the spread and the ceiling the run could not decide", () => {
    const table = formatUnmeasuredTable([
      { path: "/activity", metric: "lcpMs", budget: 300, median: 396, min: 212, max: 512, spreadPct: 76 },
    ]);
    expect(table).toContain("/activity");
    expect(table).toContain("LCP (ms)");
    expect(table).toContain("212 to 512");
    expect(table).toContain("76%");
    expect(table).toContain("300");
  });

  it("prints how far over its ceiling the median sat, so a parked route is visible every sweep", () => {
    // A route whose excess is smaller than its own jitter reads unmeasured on
    // every run, so the excess is the figure a reader watches for a return.
    const table = formatUnmeasuredTable([
      { path: "/rounds", metric: "lcpMs", budget: 300, median: 310, min: 286, max: 334, spreadPct: 15 },
    ]);
    expect(table).toContain("excess");
    expect(table).toContain("+10");
  });

  it("prints a median under its ceiling as the negative excess it is", () => {
    const table = formatUnmeasuredTable([
      { path: "/rounds", metric: "lcpMs", budget: 300, median: 250, min: 200, max: 1000, spreadPct: 320 },
    ]);
    expect(table).toContain("-50");
  });
});

// THE TWO RUNS THAT PROVED THE SWEEP UNSTABLE, REPLAYED.
//
// Job 103319591915 and its re-run, both on commit 3ebac98ac, both on the same
// runner label, with nothing in the tree changing between them. They printed 8
// and 6 breached routes and shared only three, and the routes unique to one of
// them are the ones whose samples straddled their own ceiling. These are the
// figures off those two logs, replayed through the decision.
describe("the disjoint breach sets of 3ebac98ac", () => {
  const method: BudgetMethod = { ...PERFORMANCE_BUDGETS.method, sampleSpreadWarnPct: 12 };
  const verdictFor = (path: string, ceiling: number, samples: number[]) => {
    const rows: SampleRow[] = samples.map((lcpMs) => ({
      serverRenderMs: 0,
      jsDecodedKB: 0,
      requests: 0,
      lcpMs,
    }));
    return judgeBudgets(
      [route({ path, lcpMs: ceiling })],
      new Map([[path, measurement({ lcpMs: median(samples) })]]),
      new Map([[path, rows]]),
      method,
    );
  };

  // Every LCP row the two runs printed as a breach, with the samples behind it.
  const rows: Array<[string, number, number[], "breach" | "unmeasured"]> = [
    // First run.
    ["/today", 300, [392, 744, 480, 848, 680, 372, 352], "breach"],
    ["/feed", 400, [444, 348, 360, 428, 436], "unmeasured"],
    ["/messages", 800, [836, 744, 936, 920, 1004], "unmeasured"],
    ["/activity", 300, [292, 356, 336, 316, 264], "unmeasured"],
    ["/choose-city", 300, [348, 488, 292, 312, 336], "unmeasured"],
    ["/crawls", 300, [276, 376, 332, 644, 408, 392, 348], "unmeasured"],
    ["/borough", 400, [400, 516, 416, 352, 408], "unmeasured"],
    ["/places", 300, [284, 224, 452, 344, 368], "unmeasured"],
    // Second run, same commit.
    ["/activity", 300, [212, 396, 512, 392, 444], "unmeasured"],
    ["/choose-city", 300, [476, 336, 356, 408, 256], "unmeasured"],
    ["/moment", 300, [372, 308, 324, 348, 260], "unmeasured"],
    ["/rounds", 300, [328, 260, 240, 312, 308], "unmeasured"],
    // The second of the three that stay red. Its seven samples ran 308 to 408
    // and NOT ONE of them met the 300 ms ceiling, so no median this evidence
    // allows is under it. The route already carries a `noisy` record and spent
    // the extra samples, so the evidence is bought and spent: the answer is the
    // route or a deliberate decision, never a wider band.
    ["/crawls", 300, [328, 320, 408, 308, 376, 336, 308], "breach"],
    // The third, and the one no spread rule can help: 9 per cent apart is a run
    // that agreed with itself, and what it agreed on was 408 against a 400 ms
    // ceiling. The first run measured the same route at 392 and passed. A route
    // sitting ON its line is a product decision.
    ["/historic", 400, [408, 384, 400, 420, 420], "breach"],
  ];

  for (const [path, ceiling, samples, expected] of rows) {
    it(`reads ${path} at ${median(samples)} against ${ceiling} as ${expected}`, () => {
      const verdict = verdictFor(path, ceiling, samples);
      const lcpBreach = verdict.breaches.filter((breach) => breach.metric === "lcpMs");
      const lcpUnmeasured = verdict.unmeasured.filter((entry) => entry.metric === "lcpMs");
      if (expected === "breach") {
        expect(lcpBreach).toHaveLength(1);
        expect(lcpUnmeasured).toEqual([]);
      } else {
        expect(lcpBreach).toEqual([]);
        expect(lcpUnmeasured).toHaveLength(1);
        expect(defined(lcpUnmeasured[0]).median).toBe(median(samples));
      }
    });
  }

  it("keeps /today red on the run in which no sample met the ceiling", () => {
    // Eleven of the fourteen rows above stop being breaches. This is one of the
    // three that must not: the first run's seven samples spread 103 per cent
    // and the FASTEST of them was 352 ms against a 300 ms ceiling. The second
    // run measured the same route at 272, with samples that did meet the line,
    // so that run reports the ceiling as undecided rather than breached, which
    // is the honest answer for its evidence.
    expect(verdictFor("/today", 300, [392, 744, 480, 848, 680, 372, 352]).breaches).toHaveLength(1);
    const second = verdictFor("/today", 300, [248, 276, 276, 264, 248, 496, 272]);
    expect(second.breaches).toEqual([]);
    expect(second.unmeasured.map((entry) => entry.metric)).toEqual(["lcpMs"]);
  });
});
