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

/** One breached route and metric, as the sweep measured it. */
export type AbBreach = {
  path: string;
  metric: BudgetMetric;
  measured: number;
  budget: number;
};

/** The breach list as the sweep hands it over. */
export type AbBreachHandover = {
  /** The head the sweep measured, for the log. */
  head: string;
  measuredAt: string;
  breaches: AbBreach[];
};

/**
 * The handover the sweep writes, or null when there is nothing to hand over.
 *
 * The sweep writes the file ONLY when this returns one, which is what keeps the
 * merge-base build off the critical path of a green run: with no file the
 * script stops before it creates a worktree or starts a build.
 */
export function abHandoverForBreaches(
  breaches: readonly AbBreach[],
  head: string,
  measuredAt: string = new Date().toISOString(),
): AbBreachHandover | null {
  if (breaches.length === 0) return null;
  return {
    head,
    measuredAt,
    breaches: breaches.map((breach) => ({
      path: breach.path,
      metric: breach.metric,
      measured: breach.measured,
      budget: breach.budget,
    })),
  };
}

/**
 * HOW MANY BREACHED METRICS ONE A/B MEASURES, AND WHY THERE IS A CEILING ON IT.
 *
 * A mass breach is the very signature of a slow box: on 11 September 2026 one
 * job measured 43 of 44 budgeted routes about a third slower. Measuring every
 * one of them against a second build costs two arms times eight navigations a
 * route, which walks the job into its own wall - and a job cancelled at the
 * wall uploads nothing, so the evidence is lost in exactly the case it was
 * built for. A partial answer that arrives beats a whole one that does not.
 */
export const PERF_AB_BREACH_CAP = 8;

export type AbBreachSelection = {
  /** Distinct routes the sweep breached. */
  breachedRoutes: number;
  /** Distinct routes this A/B measures against the merge base. */
  measuredRoutes: number;
  /** The breached metrics it measures, worst first. */
  breaches: AbBreach[];
  /** Breached metrics the cap left unmeasured. Zero when the cap did not bite. */
  skipped: number;
};

/** How far one measured figure sits past its own ceiling, against that ceiling. */
function excessOverCeiling(breach: AbBreach): number {
  if (!Number.isFinite(breach.measured) || !Number.isFinite(breach.budget)) return 0;
  if (breach.budget > 0) return (breach.measured - breach.budget) / breach.budget;
  return breach.measured;
}

function countRoutes(breaches: readonly AbBreach[]): number {
  return new Set(breaches.map((breach) => breach.path)).size;
}

/**
 * The breached metrics this A/B measures, worst first, capped.
 *
 * Worst first because a cap that bites has to leave out the breaches that
 * explain least, and because a job killed part way through has by then measured
 * the ones an author asks about first.
 */
export function selectAbBreaches(
  breaches: readonly AbBreach[],
  cap: number = PERF_AB_BREACH_CAP,
): AbBreachSelection {
  const worstFirst = breaches
    .map((breach, order) => ({ breach, order }))
    .sort((left, right) => {
      const difference = excessOverCeiling(right.breach) - excessOverCeiling(left.breach);
      return difference !== 0 ? difference : left.order - right.order;
    })
    .map((entry) => entry.breach);
  const measured = worstFirst.slice(0, Math.max(cap, 0));
  return {
    breachedRoutes: countRoutes(breaches),
    measuredRoutes: countRoutes(measured),
    breaches: measured,
    skipped: worstFirst.length - measured.length,
  };
}

/**
 * What the report says about its own scope, before any figure.
 *
 * The breached count comes FIRST and the measured count second, so nobody reads
 * eight A/B rows as eight breaches. A cap that bit says so on its own line
 * rather than truncating in silence.
 */
export function formatAbScopeLines(
  selection: AbBreachSelection,
  cap: number = PERF_AB_BREACH_CAP,
): string[] {
  const lines = [
    `${selection.breachedRoutes} route(s) breached; ${selection.measuredRoutes} measured ` +
      "against the merge base.",
  ];
  if (selection.skipped > 0) {
    lines.push(
      `The A/B measures at most ${cap} breached metrics, worst first by how far each figure ` +
        `sits past its own ceiling, so ${selection.skipped} more went unmeasured. A mass breach ` +
        "is itself the signature of a slow box.",
    );
  }
  return lines;
}

/**
 * WHICH ARM GOES FIRST ON THE NTH COUNTED NAVIGATION.
 *
 * Interleaved, so drift during the run falls across both arms in the same
 * proportion and cancels in the difference. ALTERNATED, so a drift that only
 * ever moves one way does not settle on whichever arm is always second.
 */
export function abArmOrder(
  run: number,
): readonly ["branch", "base"] | readonly ["base", "branch"] {
  return run % 2 === 0 ? (["branch", "base"] as const) : (["base", "branch"] as const);
}

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
  /**
   * The same difference against the base figure, as a whole percentage, for
   * display. The verdict below reads the UNROUNDED ratio, so 12.4 per cent
   * slower against a band of 12 is BRANCH SLOWER and still prints +12%.
   */
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

/**
 * The exact difference as a percentage of the base figure.
 *
 * It is NOT rounded here: rounding before the band is tested reads 12.4 per
 * cent slower as 12, which fails `> 12` and labels a real regression NOT SLOWER
 * THAN BASE. `formatAbTable` rounds for the eye instead.
 */
function relativeDeltaPct(branchMedian: number, baseMedian: number): number {
  if (baseMedian > 0) return ((branchMedian - baseMedian) / baseMedian) * 100;
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
    const exactPct = compared ? relativeDeltaPct(branchMedian, baseMedian) : Number.NaN;
    const deltaPct = compared ? Math.round(exactPct) : Number.NaN;
    const verdict: AbVerdict = !compared
      ? "NOT COMPARED"
      : exactPct > band
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
