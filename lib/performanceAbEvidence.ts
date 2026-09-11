import {
  BUDGET_METRIC_LABELS,
  median,
  type BudgetMethod,
  type BudgetMetric,
} from "./performanceBudgets";

/**
 * DID THE BRANCH MAKE THAT ROUTE SLOWER, OR IS THIS BOX SLOWER THAN THE ONE
 * THAT SET THE CEILING?
 *
 * This module is the arithmetic half of the answer. It decides nothing about
 * pass or fail: `findBudgetBreaches` still judges the medians it is handed, the
 * breach list still fails the build, and no ceiling anywhere is read here. What
 * it adds is the second reading an author needs the moment a route goes red.
 *
 * WHY IT EXISTS. On 11 September 2026 four Performance budget runs produced
 * four DIFFERENT failing route sets on branches whose diffs cannot touch a
 * route, two runs on the identical head disagreed with each other, and against
 * the last green job 43 of 44 budgeted routes measured about a third slower on
 * the same shared pool. The gate was reporting the runner. A ceiling comes down
 * and never up, so the answer to a figure nobody can repeat is more evidence
 * rather than a bigger number, and the evidence that settles it is the merge
 * base measured on THE SAME BOX in THE SAME JOB.
 *
 * WHAT IT CAN PROVE: that this box measured the branch no slower than the code
 * the branch started from, which is what the standing law asks for before a red
 * check is re-run. WHAT IT CANNOT: that the route is fast, that the ceiling is
 * right, or that the branch is innocent of anything the A/B did not measure.
 * Both arms can sit far over a ceiling and the verdict still reads NOT SLOWER
 * THAN BASE, because the ceiling is not in this comparison at all.
 *
 * "Slower" is the one word for a worse figure on all four metrics. On the byte
 * and count metrics it reads as heavier; one word keeps the table one shape and
 * the verdict one question.
 */

/**
 * WHERE THE SWEEP LEAVES ITS BREACH LIST FOR THE A/B TO PICK UP.
 *
 * The sweep writes this file ONLY when it has a breach, so a green sweep leaves
 * nothing behind and the A/B step finds nothing to do and costs nothing. It
 * lives under `test-results/`, which is already ignored by git and already
 * where the browser suite puts what it produces.
 *
 * `scripts/perf-ab.mjs` reads the same path. It cannot import this module (it
 * is a plain Node script), so `__tests__/performanceAbEvidence.test.ts` holds
 * the two together rather than trusting them to stay in step.
 */
export const PERF_AB_BREACH_FILE = "test-results/perf-budget-breaches.json";

/** The breach list as the sweep hands it over. */
export type AbBreachHandover = {
  /** The head the sweep measured, for the log. */
  head: string;
  measuredAt: string;
  breaches: Array<{
    path: string;
    metric: BudgetMetric;
    measured: number;
    budget: number;
  }>;
};

/** One breached route and metric, with the samples both arms took for it. */
export type AbRoutePair = {
  path: string;
  metric: BudgetMetric;
  /** This route's ceiling. Reported beside the figures, never read by the verdict. */
  budget: number;
  /** The samples this branch's build took, in the order they were taken. */
  branch: readonly number[];
  /** The samples the merge-base build took, interleaved with the branch's. */
  base: readonly number[];
};

/**
 * BRANCH SLOWER is a regression this run can defend. NOT SLOWER THAN BASE is
 * the evidence that a red route is the box rather than the branch. NOT COMPARED
 * is an arm that never measured: absence of evidence convicts nobody and clears
 * nobody.
 */
export type AbVerdict = "BRANCH SLOWER" | "NOT SLOWER THAN BASE" | "NOT COMPARED";

export type AbComparison = {
  path: string;
  metric: BudgetMetric;
  budget: number;
  branchMedian: number;
  baseMedian: number;
  /** Branch minus base, in the metric's own units. */
  delta: number;
  /** The same difference against the base figure, as a whole percentage. */
  deltaPct: number;
  verdict: AbVerdict;
  /**
   * True only when this route went past its ceiling AND measured no slower than
   * the merge base on this box. That pair of facts is runner drift, and
   * `formatAbVerdictLines` says so in those words.
   */
  runnerDrift: boolean;
};

/**
 * How far apart the two arms may sit before the difference is the branch's.
 *
 * It is the method's OWN tracked sample width rather than a second number typed
 * here: the sweep already records how far one route's samples may spread before
 * the run is called wide, and a separate band would be a second opinion about
 * the same noise, free to drift away from it.
 */
export function abNoiseBandPct(method: BudgetMethod): number {
  return method.sampleSpreadWarnPct;
}

function relativeDeltaPct(branchMedian: number, baseMedian: number): number {
  if (baseMedian > 0) return Math.round(((branchMedian - baseMedian) / baseMedian) * 100);
  // A base of zero has no proportion to take. A branch that matches it is not
  // slower; anything above it is entirely new cost.
  if (branchMedian <= baseMedian) return 0;
  return Number.POSITIVE_INFINITY;
}

/**
 * The verdict per breached route and metric, in the order the breaches arrived.
 *
 * The ceiling is deliberately absent from every test below. A route three times
 * over its budget on both arms is NOT SLOWER THAN BASE, and it still fails the
 * build, because the breach list is a different question judged elsewhere.
 */
export function compareArms(
  pairs: readonly AbRoutePair[],
  method: BudgetMethod,
): AbComparison[] {
  const band = abNoiseBandPct(method);
  return pairs.map((pair) => {
    const branchSamples = pair.branch.filter((value) => Number.isFinite(value));
    const baseSamples = pair.base.filter((value) => Number.isFinite(value));
    const branchMedian = branchSamples.length > 0 ? median(branchSamples) : Number.NaN;
    const baseMedian = baseSamples.length > 0 ? median(baseSamples) : Number.NaN;
    const compared = Number.isFinite(branchMedian) && Number.isFinite(baseMedian);
    const delta = compared ? branchMedian - baseMedian : Number.NaN;
    const deltaPct = compared ? relativeDeltaPct(branchMedian, baseMedian) : Number.NaN;
    const verdict: AbVerdict = !compared
      ? "NOT COMPARED"
      : deltaPct > band
        ? "BRANCH SLOWER"
        : "NOT SLOWER THAN BASE";
    return {
      path: pair.path,
      metric: pair.metric,
      budget: pair.budget,
      branchMedian,
      baseMedian,
      delta,
      deltaPct,
      verdict,
      runnerDrift:
        verdict === "NOT SLOWER THAN BASE" &&
        Number.isFinite(pair.budget) &&
        branchMedian > pair.budget,
    };
  });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

function signedPct(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value}%`;
}

/**
 * The A/B table. Empty string when nothing was compared, so a green sweep never
 * prints a header with no rows under it.
 */
export function formatAbTable(rows: readonly AbComparison[]): string {
  if (rows.length === 0) return "";
  const body = rows.map((row) => [
    row.path,
    BUDGET_METRIC_LABELS[row.metric],
    figure(row.budget),
    figure(row.branchMedian),
    figure(row.baseMedian),
    signedPct(row.deltaPct),
    row.verdict,
  ]);
  const header = ["route", "metric", "ceiling", "branch", "base", "delta", "verdict"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((line) => line[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...body.map(line),
  ].join("\n");
}

/**
 * The sentence each row earns, under the table.
 *
 * A route that breached its ceiling while measuring no slower than the merge
 * base is named RUNNER DRIFT in those words, because that is the phrase the
 * standing law asks for before a red check is re-run on the captain's word.
 */
export function formatAbVerdictLines(rows: readonly AbComparison[]): string[] {
  return rows.map((row) => {
    const metric = BUDGET_METRIC_LABELS[row.metric];
    const figures =
      `branch ${figure(row.branchMedian)}, base ${figure(row.baseMedian)}, ` +
      `ceiling ${figure(row.budget)}`;
    if (row.verdict === "NOT COMPARED") {
      return `${row.path} ${metric}: one arm never measured (${figures}), so this run says nothing about it.`;
    }
    if (row.verdict === "BRANCH SLOWER") {
      return `${row.path} ${metric}: ${signedPct(row.deltaPct)} against the merge base on this box (${figures}): BRANCH SLOWER.`;
    }
    if (row.runnerDrift) {
      return (
        `${row.path} ${metric}: breached its ceiling and measured no slower than the merge base ` +
        `on this box (${figures}, ${signedPct(row.deltaPct)}): runner drift.`
      );
    }
    return `${row.path} ${metric}: ${signedPct(row.deltaPct)} against the merge base on this box (${figures}): NOT SLOWER THAN BASE.`;
  });
}
