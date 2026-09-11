import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";
import {
  PERF_AB_BREACH_FILE,
  abNoiseBandPct,
  compareArms,
  formatAbTable,
  formatAbVerdictLines,
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

describe("the handover between the sweep and the A/B", () => {
  const root = process.cwd();

  it("names one file, and the script that reads it names the same one", () => {
    // scripts/perf-ab.mjs is plain Node and cannot import this constant, so the
    // two are held together here. A handover written to one path and read from
    // another is an A/B that silently never runs.
    const script = readFileSync(path.join(root, "scripts", "perf-ab.mjs"), "utf8");
    expect(script).toContain(PERF_AB_BREACH_FILE);
  });

  it("is written by the sweep only when the sweep has a breach", () => {
    // The second build must stay off the critical path of a green run.
    const spec = readFileSync(
      path.join(root, "e2e", "performance-budget.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("if (breaches.length > 0) {");
    expect(spec).toContain("writeFileSync(PERF_AB_BREACH_FILE");
  });

  it("leaves the breach list itself as the gate", () => {
    // The A/B may print anything it likes; the expect below it is what fails
    // the build, and it is still judging findBudgetBreaches.
    const spec = readFileSync(
      path.join(root, "e2e", "performance-budget.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("const breaches = findBudgetBreaches(budgets.routes, measured);");
    expect(spec).toContain(").toEqual([]);");
  });

  it("interleaves the two arms rather than running one after the other", () => {
    // A sequential A-then-B on a drifting box measures the drift, so the
    // alternating pair is pinned here rather than left to a reviewer's memory.
    const spec = readFileSync(
      path.join(root, "e2e", "performance-budget-ab.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("run % 2 === 0 ? [branch, base] : [base, branch]");
  });
});
