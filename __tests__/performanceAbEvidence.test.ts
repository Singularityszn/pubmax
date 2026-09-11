import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";
import {
  PERF_AB_BREACH_CAP,
  PERF_AB_BREACH_FILE,
  abArmOrder,
  abHandoverForBreaches,
  abNoiseBandPct,
  compareArms,
  formatAbScopeLines,
  formatAbTable,
  formatAbVerdictLines,
  selectAbBreaches,
  type AbBreach,
  type AbRoutePair,
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

describe("selectAbBreaches", () => {
  const breach = (over: Partial<AbBreach> = {}): AbBreach => ({
    path: "/messages",
    metric: "lcpMs",
    measured: 600,
    budget: 500,
    ...over,
  });

  it("measures every breach when the sweep breached fewer than the cap", () => {
    const selection = selectAbBreaches([breach({ path: "/a" }), breach({ path: "/b" })]);
    expect(selection.breachedRoutes).toBe(2);
    expect(selection.measuredRoutes).toBe(2);
    expect(selection.skipped).toBe(0);
  });

  it("orders the breaches worst first, by how far each figure sits past its OWN ceiling", () => {
    // 220 against 200 is 10 per cent over; 700 against 500 is 40, and the
    // bigger absolute figure is not the worse breach.
    const selection = selectAbBreaches([
      breach({ path: "/small-margin", measured: 220, budget: 200 }),
      breach({ path: "/worst", measured: 700, budget: 500 }),
      breach({ path: "/middle", measured: 600, budget: 500 }),
    ]);
    expect(selection.breaches.map((entry) => entry.path)).toEqual([
      "/worst",
      "/middle",
      "/small-margin",
    ]);
  });

  it("caps a mass breach at the worst few, and says how many it left out", () => {
    // The shape the cap exists for: on 11 September 2026 one job measured 43 of
    // 44 budgeted routes about a third slower, which is the signature of a slow
    // box. Measuring all of them twice walks the job into its wall, and a
    // cancelled job uploads nothing.
    const many = Array.from({ length: 40 }, (_unused, index) =>
      breach({ path: `/route-${index}`, measured: 500 + index, budget: 500 }),
    );
    const selection = selectAbBreaches(many);
    expect(selection.breaches).toHaveLength(PERF_AB_BREACH_CAP);
    expect(selection.breaches[0].path).toBe("/route-39");
    expect(selection.breachedRoutes).toBe(40);
    expect(selection.measuredRoutes).toBe(PERF_AB_BREACH_CAP);
    expect(selection.skipped).toBe(40 - PERF_AB_BREACH_CAP);
  });

  it("counts routes rather than metrics, so two breached metrics on one route are one route", () => {
    const selection = selectAbBreaches([
      breach({ path: "/pubs", metric: "jsDecodedKB", measured: 1275, budget: 1200 }),
      breach({ path: "/pubs", metric: "requests", measured: 73, budget: 68 }),
    ]);
    expect(selection.breachedRoutes).toBe(1);
    expect(selection.measuredRoutes).toBe(1);
    expect(selection.breaches).toHaveLength(2);
  });
});

describe("formatAbScopeLines", () => {
  const breach = (index: number): AbBreach => ({
    path: `/route-${index}`,
    metric: "lcpMs",
    measured: 500 + index,
    budget: 500,
  });

  it("says how many routes breached BEFORE how many were measured", () => {
    const [line] = formatAbScopeLines(selectAbBreaches([breach(1), breach(2)]));
    expect(line.indexOf("2 route(s) breached")).toBe(0);
    expect(line).toContain("2 measured");
  });

  it("says on its own line when the cap bit, rather than truncating in silence", () => {
    const lines = formatAbScopeLines(
      selectAbBreaches(Array.from({ length: 12 }, (_unused, index) => breach(index))),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("12 route(s) breached");
    expect(lines[0]).toContain(`${PERF_AB_BREACH_CAP} measured`);
    expect(lines[1]).toContain(`${12 - PERF_AB_BREACH_CAP} more went unmeasured`);
  });

  it("stays one line when every breach was measured", () => {
    expect(formatAbScopeLines(selectAbBreaches([breach(1)]))).toHaveLength(1);
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
