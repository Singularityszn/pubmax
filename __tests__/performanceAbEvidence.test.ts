import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";
import {
  PERF_AB_ARMS,
  PERF_AB_BREACH_FILE,
  PERF_AB_JOB_WALL_MS,
  abArmOrder,
  abDeadlineReached,
  abMeasuringDeadlineMs,
  abNavigationAllowanceMs,
  abNoiseFloor,
  abRouteFitsDeadline,
  abUploadReserveMs,
  abHandoverForBreaches,
  abNavigationBudget,
  abNavigationsForRoute,
  abNoiseBandPct,
  abSamplesPerArm,
  abTimeoutMs,
  compareArms,
  formatAbReport,
  formatAbScopeLines,
  formatAbTable,
  formatAbVerdictLines,
  selectAbBreaches,
  type AbBreach,
  type AbRoutePair,
  type AbRoutePlan,
} from "@/lib/performanceAbEvidence";

// THE INSTRUMENT THAT TELLS A RED ROUTE APART FROM A SLOW BOX.
//
// The measuring runs in a browser (e2e/performance-budget-ab.spec.ts). The
// ARITHMETIC and the verdict live in the pure module beside the budgets, so
// they are pinned here with no browser and no build, the same reason
// resolveCountBoundary and medianSitsOnTheLine live there.
//
// Nothing in this file gates anything. The ceilings stay the law and the breach
// list still fails the build: this only answers the second question an author
// asks when a route goes red, which is whether the branch made it slower or the
// box did.

const method = { ...PERFORMANCE_BUDGETS.method, sampleSpreadWarnPct: 12 };

const pair = (over: Partial<AbRoutePair> = {}): AbRoutePair => ({
  path: "/messages",
  metric: "lcpMs",
  budget: 572,
  branch: [880, 888, 896],
  base: [870, 875, 884],
  plannedSamples: 3,
  ...over,
});

describe("abNoiseBandPct", () => {
  it("is the method's own tracked width rather than a second number", () => {
    // A band typed here would be a second opinion about the same noise. The
    // sweep already records how far apart one route's samples may sit before
    // the run is called wide; the A/B reads that.
    expect(abNoiseBandPct(method)).toBe(method.sampleSpreadWarnPct);
  });
});

describe("compareArms", () => {
  it("reads a branch slower than base by more than the band as BRANCH SLOWER", () => {
    const [row] = compareArms([pair({ branch: [900, 920, 940], base: [600, 610, 620] })], method);
    expect(row.branchMedian).toBe(920);
    expect(row.baseMedian).toBe(610);
    expect(row.deltaPct).toBe(51);
    expect(row.verdict).toBe("BRANCH SLOWER");
    expect(row.runnerDrift).toBe(false);
  });

  it("reads a branch inside the band as NOT SLOWER THAN BASE", () => {
    const [row] = compareArms([pair()], method);
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
  });

  it("tests the band on the UNROUNDED ratio, and rounds only for the eye", () => {
    // 112.4 against 100 is 12.4 per cent slower, past a band of 12. Rounding
    // first read it as 12, failed `> 12`, and printed NOT SLOWER THAN BASE over
    // a real regression.
    const [row] = compareArms(
      [pair({ branch: [11_240, 11_240, 11_240], base: [10_000, 10_000, 10_000] })],
      method,
    );
    expect(row.verdict).toBe("BRANCH SLOWER");
    expect(row.deltaPct).toBe(12);
  });

  it("leaves a difference exactly the width of the band inside it", () => {
    const [row] = compareArms(
      [pair({ branch: [11_200, 11_200, 11_200], base: [10_000, 10_000, 10_000] })],
      method,
    );
    expect(row.deltaPct).toBe(12);
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
  });

  it("refuses BRANCH SLOWER on a gap past the band but under the metric's own floor", () => {
    // /today carries an LCP ceiling of 300 and is marked noisy for 51 per cent
    // spreads. Base 320 against branch 360 is 12.5 per cent off 40 ms, which
    // the method itself calls unmeasurable on this box (lcpMs floor 250).
    const [row] = compareArms(
      [pair({ budget: 300, branch: [360, 360, 360], base: [320, 320, 320] })],
      method,
    );
    expect(row.deltaPct).toBe(13);
    expect(abNoiseFloor("lcpMs", method)).toBe(250);
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
  });

  it("refuses BRANCH SLOWER on a millisecond of server render, which is scheduler jitter", () => {
    const [row] = compareArms(
      [pair({ metric: "serverRenderMs", budget: 150, branch: [9, 9, 9], base: [8, 8, 8] })],
      method,
    );
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
  });

  it("reads BRANCH SLOWER once the gap clears BOTH the band and the floor", () => {
    const [row] = compareArms(
      [pair({ budget: 300, branch: [900, 900, 900], base: [600, 600, 600] })],
      method,
    );
    expect(row.deltaPct).toBe(50);
    expect(row.branchMedian - row.baseMedian).toBeGreaterThanOrEqual(
      abNoiseFloor("lcpMs", method),
    );
    expect(row.verdict).toBe("BRANCH SLOWER");
  });

  it("reads a branch faster than base as NOT SLOWER THAN BASE however far both sit over the ceiling", () => {
    // The case the whole instrument exists for: /messages measured 888 against
    // a 572 ceiling on 11 September while the merge base measured 875 on the
    // same box in the same job. Three times over the ceiling changes nothing
    // here - the ceiling is not in this verdict, and the breach list still
    // fails the build on its own.
    const [row] = compareArms(
      [pair({ budget: 200, branch: [1600, 1700, 1800], base: [1800, 1900, 2000] })],
      method,
    );
    expect(row.branchMedian).toBe(1700);
    expect(row.baseMedian).toBe(1900);
    expect(row.deltaPct).toBe(-11);
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
  });

  it("names a route that breached its ceiling and measured no slower than base as runner drift", () => {
    const [row] = compareArms([pair()], method);
    expect(row.branchMedian).toBeGreaterThan(row.budget);
    expect(row.runnerDrift).toBe(true);
    expect(formatAbVerdictLines([row]).join("\n")).toContain("runner drift");
  });

  it("never calls a branch slower than base runner drift", () => {
    const [row] = compareArms([pair({ branch: [900, 920, 940], base: [600, 610, 620] })], method);
    expect(row.runnerDrift).toBe(false);
    expect(formatAbVerdictLines([row]).join("\n")).not.toContain("runner drift");
  });

  it("reports an arm it could not measure as NOT COMPARED rather than guessing", () => {
    // Absence of evidence is not evidence of drift. A base arm that never
    // measured cannot clear a branch, and it cannot convict one either.
    const [row] = compareArms([pair({ base: [Number.NaN, Number.NaN, Number.NaN] })], method);
    expect(row.verdict).toBe("NOT COMPARED");
    expect(row.runnerDrift).toBe(false);
  });

  it("refuses a verdict on an arm that did not complete its plan", () => {
    // Two of three samples threw on the branch arm and the third read 340
    // against a base median of 305: 11.5 per cent, inside the band, which
    // printed runner drift off ONE figure on the noisiest route in the table.
    // A median of one wearing the same label as a median of seven is the
    // laundering this lane exists to stop.
    const [row] = compareArms(
      [pair({ budget: 300, branch: [Number.NaN, Number.NaN, 340], base: [300, 305, 310] })],
      method,
    );
    expect(row.branchSamples).toBe(1);
    expect(row.baseSamples).toBe(3);
    expect(row.verdict).toBe("NOT COMPARED");
    expect(row.runnerDrift).toBe(false);
    expect(formatAbVerdictLines([row]).join("\n")).not.toContain("runner drift");
  });

  it("gives a marked route's seven samples a verdict when both arms complete them", () => {
    const seven = (from: number) => Array.from({ length: 7 }, (_unused, index) => from + index);
    const [row] = compareArms(
      [pair({ branch: seven(900), base: seven(600), plannedSamples: 7 })],
      method,
    );
    expect(row.branchSamples).toBe(7);
    expect(row.plannedSamples).toBe(7);
    expect(row.verdict).toBe("BRANCH SLOWER");
  });

  it("says what backed each median on every row, whatever the verdict", () => {
    const rows = compareArms(
      [pair(), pair({ path: "/crawls", branch: [Number.NaN, Number.NaN, 340] })],
      method,
    );
    expect(formatAbTable(rows)).toContain("3/3 vs 3/3");
    expect(formatAbTable(rows)).toContain("1/3 vs 3/3");
    expect(formatAbVerdictLines(rows)[1]).toContain("from 1 of 3 samples");
  });

  it("judges a count metric the same way it judges a clock", () => {
    const [row] = compareArms(
      [pair({ metric: "requests", budget: 60, branch: [120, 120, 120], base: [60, 60, 60] })],
      method,
    );
    expect(row.verdict).toBe("BRANCH SLOWER");
    expect(row.deltaPct).toBe(100);
  });

  it("keeps one row per breached metric, in the order it was handed them", () => {
    const rows = compareArms(
      [pair({ metric: "lcpMs" }), pair({ path: "/choose-city", metric: "requests" })],
      method,
    );
    expect(rows.map((row) => `${row.path} ${row.metric}`)).toEqual([
      "/messages lcpMs",
      "/choose-city requests",
    ]);
  });
});

describe("formatAbTable", () => {
  it("prints the branch median, the base median, the delta and the verdict", () => {
    const table = formatAbTable(compareArms([pair()], method));
    expect(table).toContain("/messages");
    expect(table).toContain("branch");
    expect(table).toContain("base");
    expect(table).toContain("NOT SLOWER THAN BASE");
    expect(table).toContain("572");
  });

  it("is empty when nothing was compared, so a green sweep stays quiet", () => {
    expect(formatAbTable([])).toBe("");
    expect(formatAbVerdictLines([])).toEqual([]);
  });
});

describe("abHandoverForBreaches", () => {
  const breach: AbBreach = { path: "/messages", metric: "lcpMs", measured: 888, budget: 572 };

  it("hands nothing over when the sweep was green, so no second build is ever paid for", () => {
    // The file is written only when this returns a handover, and with no file
    // scripts/perf-ab.mjs stops before it creates a worktree or starts a build.
    expect(abHandoverForBreaches([], "abc123")).toBeNull();
  });

  it("carries the head, the moment and every breached metric the sweep measured", () => {
    const handover = abHandoverForBreaches([breach], "abc123", "2026-09-11T22:01:00.000Z");
    expect(handover).toEqual({
      head: "abc123",
      measuredAt: "2026-09-11T22:01:00.000Z",
      breaches: [breach],
    });
  });
});

describe("what the A/B spends", () => {
  const quiet: AbRoutePlan = { path: "/messages" };
  const marked: AbRoutePlan = {
    path: "/crawls",
    noisy: { metrics: ["lcpMs"], measuredSpreadPct: 51, why: "recorded wide on this rig" },
  };
  const plan = (path: string, noisy = false): AbRoutePlan =>
    noisy ? { ...marked, path } : { path };

  it("judges a marked route on the median of seven, exactly as the sweep judges it", () => {
    // Three samples cannot decide a route whose samples were recorded 51 per
    // cent apart: the arms would differ by the spread rather than by the code.
    expect(abSamplesPerArm(marked, method)).toBe(
      method.measuredRuns + (method.noisyResampleRuns ?? 0),
    );
    expect(abSamplesPerArm(marked, method)).toBe(7);
  });

  it("leaves a quiet route on its three, because it never said it could not measure", () => {
    expect(abSamplesPerArm(quiet, method)).toBe(3);
  });

  it("costs a marked route more than twice a quiet one, which is why routes are not the unit", () => {
    expect(abNavigationsForRoute(quiet, method)).toBe(PERF_AB_ARMS * (1 + 3));
    expect(abNavigationsForRoute(marked, method)).toBe(PERF_AB_ARMS * (2 + 7));
    expect(abNavigationsForRoute(marked, method)).toBeGreaterThan(
      2 * abNavigationsForRoute(quiet, method),
    );
  });

  it("budgets EIGHT ordinary routes at what the A/B itself spends on one", () => {
    // Pricing the budget off the sweep's own worst case bought a resample the
    // A/B never spends on a quiet route, so the budget admitted twelve routes
    // while every sentence describing it said eight.
    expect(abNavigationBudget(method)).toBe(8 * abNavigationsForRoute(quiet, method));
    const wider = { ...method, measuredRuns: method.measuredRuns + 1 };
    expect(abNavigationBudget(wider)).toBeGreaterThan(abNavigationBudget(method));
  });

  it("bounds ONE navigation at the same allowance the whole run is priced from", () => {
    // A page.goto bounded only by the test total is one hung load free to eat
    // the job's wall and the upload with it.
    const routeReady = 120_000;
    expect(abNavigationAllowanceMs(method, routeReady)).toBe(
      routeReady + method.network.drainCeilingMs,
    );
    expect(abTimeoutMs(5, method, routeReady)).toBe(5 * abNavigationAllowanceMs(method, routeReady));
  });

  it("allows one navigation what the harness itself allows it", () => {
    // The readiness gate may wait its whole ceiling and the network its own
    // drain ceiling, so a smaller allowance fires on precisely the slow route
    // this instrument exists to explain.
    const routeReady = 120_000;
    expect(abTimeoutMs(1, method, routeReady)).toBe(
      routeReady + method.network.drainCeilingMs,
    );
    expect(abTimeoutMs(16, method, routeReady)).toBe(
      16 * (routeReady + method.network.drainCeilingMs),
    );
  });

  it("keeps its measuring deadline inside the job's wall, with room for the upload", () => {
    // A run bounded only by the job's wall is a run GitHub cancels, and a
    // cancelled job never reaches the step that uploads the report.
    expect(abMeasuringDeadlineMs()).toBeLessThan(PERF_AB_JOB_WALL_MS);
    expect(abMeasuringDeadlineMs()).toBe(PERF_AB_JOB_WALL_MS - abUploadReserveMs());
    // Derived from the wall, so moving `timeout-minutes` moves this with it.
    expect(abMeasuringDeadlineMs(0, 2 * PERF_AB_JOB_WALL_MS)).toBeGreaterThan(
      abMeasuringDeadlineMs(),
    );
  });

  it("shrinks the deadline by what the sweep and the merge-base build already spent", () => {
    // The sweep, the install and the build are not bounded by anything this
    // module can see, and on a slow box they are what overruns. A quarter of a
    // wall that is already gone is not a share.
    const spentMost = abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS - 6 * 60_000);
    expect(spentMost).toBeLessThan(6 * 60_000);
    expect(spentMost).toBeLessThan(abMeasuringDeadlineMs(10 * 60_000));
  });

  it("yields no measuring at all once the wall is spent, never a negative deadline", () => {
    expect(abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS)).toBe(0);
    expect(abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS * 2)).toBe(0);
    // And with nothing left, no route is ever admitted.
    expect(
      abRouteFitsDeadline({
        navigations: 8,
        remainingMs: abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS),
        observedMsPerNavigation: null,
      }),
    ).toBe(false);
  });

  it("always keeps the upload a share of the wall, whatever the measuring wants", () => {
    expect(abUploadReserveMs()).toBeGreaterThan(0);
    expect(abMeasuringDeadlineMs(0) + abUploadReserveMs()).toBe(PERF_AB_JOB_WALL_MS);
  });

  it("hands back nothing once only the upload's share is left, never a negative bound", () => {
    // Every phase of the A/B - the merge base's install, its build and the
    // measuring - reads this figure. A phase bounded at the WHOLE wall left is
    // killed at the instant GitHub cancels the job, so it never prints why and
    // the upload step never runs.
    const reserveHalfEaten = PERF_AB_JOB_WALL_MS - Math.floor(abUploadReserveMs() / 2);
    expect(abMeasuringDeadlineMs(reserveHalfEaten)).toBe(0);
    expect(abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS - abUploadReserveMs())).toBe(0);
    // One millisecond earlier there is exactly one millisecond to spend.
    expect(abMeasuringDeadlineMs(PERF_AB_JOB_WALL_MS - abUploadReserveMs() - 1)).toBe(1);
  });

  it("stops the run when the deadline has passed and not before", () => {
    const started = 1_000;
    expect(abDeadlineReached(started, started + 60_000, 120_000)).toBe(false);
    expect(abDeadlineReached(started, started + 120_000, 120_000)).toBe(true);
    expect(abDeadlineReached(started, started + 600_000, 120_000)).toBe(true);
  });

  it("never starts a route whose whole plan does not fit what is left", () => {
    // A route started with less time left than its plan costs spends the time
    // and still hands over NOT COMPARED, so the time buys nothing.
    const marked = abNavigationsForRoute(plan("/crawls", true), method);
    expect(
      abRouteFitsDeadline({
        navigations: marked,
        remainingMs: marked * 20_000,
        observedMsPerNavigation: 20_000,
      }),
    ).toBe(true);
    expect(
      abRouteFitsDeadline({
        navigations: marked,
        remainingMs: marked * 20_000 - 1,
        observedMsPerNavigation: 20_000,
      }),
    ).toBe(false);
  });

  it("prices the route at THIS run's own pace, so a fast box fits more routes", () => {
    const quiet = abNavigationsForRoute(plan("/messages"), method);
    const remainingMs = quiet * 10_000;
    expect(
      abRouteFitsDeadline({ navigations: quiet, remainingMs, observedMsPerNavigation: 5_000 }),
    ).toBe(true);
    expect(
      abRouteFitsDeadline({ navigations: quiet, remainingMs, observedMsPerNavigation: 20_000 }),
    ).toBe(false);
  });

  it("admits the first route, because a run with no pace yet has measured nothing to report", () => {
    expect(
      abRouteFitsDeadline({
        navigations: 999,
        remainingMs: 60_000,
        observedMsPerNavigation: null,
      }),
    ).toBe(true);
  });

  it("admits nothing once the deadline is spent, whatever the pace", () => {
    expect(
      abRouteFitsDeadline({ navigations: 1, remainingMs: 0, observedMsPerNavigation: null }),
    ).toBe(false);
  });

  it("times the run out on what it will actually spend, not on every budgeted route", () => {
    const routeReady = 120_000;
    const everyBudgetedRoute = abTimeoutMs(
      PERFORMANCE_BUDGETS.routes.length * abNavigationsForRoute(quiet, method),
      method,
      routeReady,
    );
    const twoBreachedRoutes = abTimeoutMs(
      2 * abNavigationsForRoute(quiet, method),
      method,
      routeReady,
    );
    expect(twoBreachedRoutes).toBeLessThan(everyBudgetedRoute);
  });
});

describe("selectAbBreaches", () => {
  const plan = (path: string, noisy = false): AbRoutePlan =>
    noisy
      ? {
          path,
          noisy: { metrics: ["lcpMs"], measuredSpreadPct: 51, why: "recorded wide on this rig" },
        }
      : { path };

  const breach = (over: Partial<AbBreach> = {}): AbBreach => ({
    path: "/messages",
    metric: "lcpMs",
    measured: 600,
    budget: 500,
    ...over,
  });

  it("measures every breach when the sweep breached less than the budget", () => {
    const selection = selectAbBreaches(
      [breach({ path: "/a" }), breach({ path: "/b" })],
      [plan("/a"), plan("/b")],
      method,
    );
    expect(selection.breachedRoutes).toBe(2);
    expect(selection.unreached).toEqual([]);
    expect(selection.unbudgeted).toEqual([]);
    expect(selection.navigations).toBe(2 * abNavigationsForRoute(plan("/a"), method));
  });

  it("orders the routes worst first, by how far each figure sits past its OWN ceiling", () => {
    // 220 against 200 is 10 per cent over; 700 against 500 is 40, and the
    // bigger absolute figure is not the worse breach.
    const selection = selectAbBreaches(
      [
        breach({ path: "/small-margin", measured: 220, budget: 200 }),
        breach({ path: "/worst", measured: 700, budget: 500 }),
        breach({ path: "/middle", measured: 600, budget: 500 }),
      ],
      [plan("/small-margin"), plan("/worst"), plan("/middle")],
      method,
    );
    expect(selection.breaches.map((entry) => entry.path)).toEqual([
      "/worst",
      "/middle",
      "/small-margin",
    ]);
  });

  it("leaves a route whose whole plan does not fit UNMEASURED rather than half-measuring it", () => {
    // Half a route's samples is a median nobody can defend.
    const quietCost = abNavigationsForRoute(plan("/a"), method);
    const selection = selectAbBreaches(
      [
        breach({ path: "/a", measured: 900, budget: 500 }),
        breach({ path: "/b", measured: 600, budget: 500 }),
      ],
      [plan("/a"), plan("/b")],
      method,
      quietCost,
    );
    expect(selection.breaches.map((entry) => entry.path)).toEqual(["/a"]);
    expect(selection.unreached).toEqual(["/b"]);
    expect(selection.navigations).toBe(quietCost);
  });

  it("fits a cheaper route the budget still has room for after an expensive one is skipped", () => {
    const marked = plan("/crawls", true);
    const quiet = plan("/messages");
    const selection = selectAbBreaches(
      [
        breach({ path: "/crawls", measured: 900, budget: 500 }),
        breach({ path: "/messages", measured: 600, budget: 500 }),
      ],
      [marked, quiet],
      method,
      abNavigationsForRoute(quiet, method),
    );
    expect(selection.unreached).toEqual(["/crawls"]);
    expect(selection.breaches.map((entry) => entry.path)).toEqual(["/messages"]);
  });

  it("costs a marked route its noise floor, so fewer of them fit than quiet ones", () => {
    const marked = [plan("/today", true), plan("/crawls", true), plan("/discover", true)];
    const budget = abNavigationsForRoute(marked[0], method) * 2;
    const selection = selectAbBreaches(
      marked.map((route, index) => breach({ path: route.path, measured: 900 - index, budget: 500 })),
      marked,
      method,
      budget,
    );
    expect(selection.breaches.map((entry) => entry.path)).toHaveLength(2);
    expect(selection.unreached).toHaveLength(1);
    expect(selection.navigations).toBe(budget);
  });

  it("keeps both breached metrics of one route together, and counts it as one route", () => {
    const selection = selectAbBreaches(
      [
        breach({ path: "/pubs", metric: "jsDecodedKB", measured: 1275, budget: 1200 }),
        breach({ path: "/pubs", metric: "requests", measured: 73, budget: 68 }),
      ],
      [plan("/pubs")],
      method,
    );
    expect(selection.breachedRoutes).toBe(1);
    expect(selection.breaches).toHaveLength(2);
    expect(selection.navigations).toBe(abNavigationsForRoute(plan("/pubs"), method));
  });

  it("cannot measure a breached path that carries no budgeted route, and names it", () => {
    const selection = selectAbBreaches([breach({ path: "/gone" })], [], method);
    expect(selection.breaches).toEqual([]);
    expect(selection.unbudgeted).toEqual(["/gone"]);
    expect(selection.unreached).toEqual([]);
  });
});

describe("formatAbScopeLines", () => {
  const plan = (path: string): AbRoutePlan => ({ path });
  const breach = (path: string, measured: number): AbBreach => ({
    path,
    metric: "lcpMs",
    measured,
    budget: 500,
  });

  it("says how many routes breached BEFORE how many were measured", () => {
    const selection = selectAbBreaches(
      [breach("/a", 600), breach("/b", 700)],
      [plan("/a"), plan("/b")],
      method,
    );
    const [line] = formatAbScopeLines(selection, 2, 16);
    expect(line.indexOf("2 route(s) breached")).toBe(0);
    expect(line).toContain("2 measured");
  });

  it("counts what the run MEASURED, never what the budget admitted", () => {
    // A deadline-stopped run said "8 measured" two lines above "PARTIAL: 2 of
    // 8", and the first sentence is the one an author quotes.
    const selection = selectAbBreaches(
      [breach("/a", 900), breach("/b", 700), breach("/c", 600)],
      [plan("/a"), plan("/b"), plan("/c")],
      method,
    );
    expect(selection.breaches).toHaveLength(3);
    expect(formatAbScopeLines(selection, 1, 8)[0]).toContain("1 measured");
  });

  it("names the routes the budget could not reach, on its own line", () => {
    const selection = selectAbBreaches(
      [breach("/a", 900), breach("/b", 700), breach("/c", 600)],
      [plan("/a"), plan("/b"), plan("/c")],
      method,
      abNavigationsForRoute(plan("/a"), method),
    );
    const lines = formatAbScopeLines(selection, 1, 8);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("3 route(s) breached");
    expect(lines[0]).toContain("1 measured");
    expect(lines[1]).toContain("/b");
    expect(lines[1]).toContain("/c");
  });

  it("prints the navigations the run SPENT beside what it measured", () => {
    // The route count was fixed one round earlier and this number was left
    // behind, so one sentence carried an honest count and a dishonest one.
    const selection = selectAbBreaches(
      [breach("/a", 900), breach("/b", 700), breach("/c", 600)],
      [plan("/a"), plan("/b"), plan("/c")],
      method,
      abNavigationsForRoute(plan("/a"), method),
    );
    const planned = selection.navigations;
    const lines = formatAbScopeLines(selection, 1, planned / 2);
    expect(lines[0]).toContain(`spending ${planned / 2} navigation(s)`);
    // The budget is a PLAN and keeps its own sentence: joined to the spend, a
    // deadline-stopped run read as a budget of 64 leaving a route out while 12
    // were spent.
    expect(lines[1]).toContain(`planned ${planned}`);
    expect(lines[1]).not.toContain(`spent ${planned / 2}`);
  });

  it("blames an unbudgeted breached path on the budget files disagreeing, not on spend", () => {
    const selection = selectAbBreaches([breach("/gone", 900)], [], method);
    const lines = formatAbScopeLines(selection, 0, 0);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("/gone");
    expect(lines[1]).toContain("perf/route-budgets.json");
    expect(lines[1]).not.toContain("budget left out");
  });

  it("stays one line when every breached route was measured", () => {
    expect(
      formatAbScopeLines(selectAbBreaches([breach("/a", 600)], [plan("/a")], method), 1, 8),
    ).toHaveLength(1);
  });
});

describe("formatAbReport", () => {
  const selection = selectAbBreaches(
    [
      { path: "/messages", metric: "lcpMs", measured: 888, budget: 572 },
      { path: "/crawls", metric: "lcpMs", measured: 700, budget: 500 },
      { path: "/today", metric: "lcpMs", measured: 600, budget: 500 },
    ],
    [{ path: "/messages" }, { path: "/crawls" }, { path: "/today" }],
    method,
  );

  const report = (
    routesMeasured: number,
    routesSelected: number,
    deadlineNotStarted: string[] = [],
  ) =>
    formatAbReport({
      branchOrigin: "http://localhost:3500",
      baseOrigin: "http://localhost:3501",
      head: "abc123",
      selection,
      rows: compareArms([pair()], method),
      routesMeasured,
      routesSelected,
      navigationsSpent: 16,
      deadlineNotStarted,
      deadlineMs: 600_000,
    });

  it("never claims more measured routes in its scope line than it measured", () => {
    const stopped = report(1, 3, ["/crawls", "/today"]);
    expect(stopped).toContain("3 route(s) breached; 1 measured");
    expect(stopped).toContain("PARTIAL: 1 of 3");
    expect(stopped).not.toContain("3 measured");
  });

  it("separates a route it NEVER STARTED from one it stopped PART WAY THROUGH", () => {
    // One heading over both put "did not reach /crawls" above a table carrying
    // /crawls rows.
    const mixed = formatAbReport({
      branchOrigin: "http://localhost:3500",
      baseOrigin: "http://localhost:3501",
      head: "abc123",
      selection,
      rows: compareArms([pair()], method),
      routesMeasured: 1,
      routesSelected: 3,
      navigationsSpent: 16,
      deadlineNotStarted: ["/today"],
      deadlineStoppedPartWay: ["/crawls"],
      deadlineMs: 600_000,
    });
    expect(mixed).toContain("NEVER STARTED /today");
    expect(mixed).toContain("STOPPED /crawls PART WAY THROUGH");
    expect(mixed).toContain("read NOT COMPARED");
  });

  it("blames the DEADLINE rather than the budget, and names what it did not reach", () => {
    const stopped = report(1, 3, ["/crawls", "/today"]);
    expect(stopped).toContain("DEADLINE ended this run, not the navigation budget");
    expect(stopped).toContain("10 minute(s)");
    expect(stopped).toContain("/crawls, /today");
    expect(stopped).toContain("/messages");
  });

  it("says nothing about a deadline on a run the deadline never stopped", () => {
    expect(report(3, 3)).not.toContain("DEADLINE");
  });

  it("says it is PARTIAL while routes are still unmeasured, and carries the rows it has", () => {
    // The run cut short is the run whose evidence matters most, and it is
    // written after every route rather than once at the end.
    expect(report(1, 3)).toContain("PARTIAL: 1 of 3");
    expect(report(1, 3)).toContain("/messages");
  });

  it("says nothing about being partial once every selected route is measured", () => {
    expect(report(3, 3)).not.toContain("PARTIAL");
    expect(report(3, 3)).toContain("the breach table is still the gate");
  });
});

describe("abArmOrder", () => {
  it("alternates which arm leads, so one-way drift never settles on one of them", () => {
    // Sequential A-then-B on a drifting box measures the drift and reports it
    // wearing the branch's name.
    expect([0, 1, 2, 3].map((run) => abArmOrder(run)[0])).toEqual([
      "branch",
      "base",
      "branch",
      "base",
    ]);
    for (const run of [0, 1, 2, 3]) {
      expect([...abArmOrder(run)].sort()).toEqual(["base", "branch"]);
    }
  });
});

describe("the handover between the sweep and the A/B", () => {
  const root = process.cwd();
  const breachFile = path.join(root, PERF_AB_BREACH_FILE);

  /** The script, stopped early: it refuses to compare without a branch build on disk. */
  function runPerfAb(): string {
    return execFileSync("node", ["scripts/perf-ab.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PW_NEXT_DIST_DIR: ".next-perf-ab-absent" },
    });
  }

  it("reads the list from the path the module names, and does nothing without one", () => {
    // scripts/perf-ab.mjs is plain Node and cannot import PERF_AB_BREACH_FILE,
    // so the script is RUN against that path rather than read. A handover
    // written to one path and looked for at another is an A/B that silently
    // never runs.
    const saved = existsSync(breachFile) ? readFileSync(breachFile, "utf8") : null;
    try {
      rmSync(breachFile, { force: true });
      expect(runPerfAb()).toContain("no breach list");

      const handover = abHandoverForBreaches(
        [{ path: "/messages", metric: "lcpMs", measured: 888, budget: 572 }],
        "abc123",
      );
      mkdirSync(path.dirname(breachFile), { recursive: true });
      writeFileSync(breachFile, `${JSON.stringify(handover, null, 2)}\n`);
      // It got past the breach gate on that file, and stopped on the next one.
      expect(runPerfAb()).toContain("the branch build is not on disk");
    } finally {
      if (saved === null) rmSync(breachFile, { force: true });
      else writeFileSync(breachFile, saved);
    }
  });
});
