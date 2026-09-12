import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";
import {
  PERF_AB_ARMS,
  PERF_AB_BREACH_FILE,
  PERF_AB_NAVIGATION_MS,
  abArmOrder,
  abHandoverForBreaches,
  abNavigationBudget,
  abNavigationsForRoute,
  abNoiseBandPct,
  abSamplesPerArm,
  abTimeoutMs,
  compareArms,
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
      [pair({ branch: [112.4, 112.4, 112.4], base: [100, 100, 100] })],
      method,
    );
    expect(row.verdict).toBe("BRANCH SLOWER");
    expect(row.deltaPct).toBe(12);
  });

  it("leaves a difference exactly the width of the band inside it", () => {
    const [row] = compareArms([pair({ branch: [112, 112, 112], base: [100, 100, 100] })], method);
    expect(row.deltaPct).toBe(12);
    expect(row.verdict).toBe("NOT SLOWER THAN BASE");
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

  it("reads its budget off the method block rather than a number typed beside it", () => {
    const wider = { ...method, measuredRuns: method.measuredRuns + 1 };
    expect(abNavigationBudget(wider)).toBeGreaterThan(abNavigationBudget(method));
    expect(abNavigationBudget(method) % PERF_AB_ARMS).toBe(0);
  });

  it("times the run out on what it will actually spend, not on every budgeted route", () => {
    expect(abTimeoutMs(16)).toBe(16 * PERF_AB_NAVIGATION_MS);
    // Two ordinary breached routes, both arms: minutes, not hours.
    expect(abTimeoutMs(2 * abNavigationsForRoute(quiet, method))).toBeLessThan(60 * 60_000);
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
    expect(selection.measuredRoutes).toBe(2);
    expect(selection.unreached).toEqual([]);
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
    expect(selection.measuredRoutes).toBe(1);
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
    expect(selection.measuredRoutes).toBe(2);
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
    expect(selection.measuredRoutes).toBe(1);
    expect(selection.breaches).toHaveLength(2);
    expect(selection.navigations).toBe(abNavigationsForRoute(plan("/pubs"), method));
  });

  it("cannot measure a breached path that carries no budgeted route, and names it", () => {
    const selection = selectAbBreaches([breach({ path: "/gone" })], [], method);
    expect(selection.measuredRoutes).toBe(0);
    expect(selection.unreached).toEqual(["/gone"]);
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
    const [line] = formatAbScopeLines(selection);
    expect(line.indexOf("2 route(s) breached")).toBe(0);
    expect(line).toContain("2 measured");
  });

  it("names the routes the budget could not reach, on its own line", () => {
    const selection = selectAbBreaches(
      [breach("/a", 900), breach("/b", 700), breach("/c", 600)],
      [plan("/a"), plan("/b"), plan("/c")],
      method,
      abNavigationsForRoute(plan("/a"), method),
    );
    const lines = formatAbScopeLines(selection);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("3 route(s) breached");
    expect(lines[0]).toContain("1 measured");
    expect(lines[1]).toContain("/b");
    expect(lines[1]).toContain("/c");
  });

  it("stays one line when every breached route was measured", () => {
    expect(
      formatAbScopeLines(selectAbBreaches([breach("/a", 600)], [plan("/a")], method)),
    ).toHaveLength(1);
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
