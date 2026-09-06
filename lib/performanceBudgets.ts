// The site's performance budgets: what each measured route is allowed to cost,
// and how an over-budget run is reported.
//
// Speed is the product's claim, so it is held by a number rather than by
// somebody's feel for it. perf/route-budgets.json is the tracked ceiling table;
// this module parses it, decides pass or fail against a measured run, and
// formats the table a failing CI job prints. It is pure and data-only on
// purpose: the measuring lives in e2e/performance-budget.spec.ts, so the rules
// can be unit-tested without a browser.
//
// docs/PERFORMANCE_BUDGETS.md owns what each metric means and the rule for
// changing a number.

import budgetsJson from "@/perf/route-budgets.json";

/**
 * The four things a route is budgeted on.
 *
 * `lcpMs` is the one a drinker actually feels: the other three are the levers
 * that move it, and a route can hold all three and still paint late. It is
 * measured by the same run, under the same method block, so the four figures
 * in a sweep describe one load rather than four.
 */
export const BUDGET_METRICS = [
  "serverRenderMs",
  "jsDecodedKB",
  "requests",
  "lcpMs",
] as const;

export type BudgetMetric = (typeof BUDGET_METRICS)[number];

/** How a metric reads in the failure table. */
export const BUDGET_METRIC_LABELS: Record<BudgetMetric, string> = {
  serverRenderMs: "server render (ms)",
  jsDecodedKB: "JS decoded (KB)",
  requests: "requests",
  lcpMs: "LCP (ms)",
};

export type RouteBudget = {
  /** The path measured, exactly as a browser would open it. */
  path: string;
  /** Rendered proof the route arrived; measurement waits for it. */
  readySelector: string;
  /** Optional loading affordance that must be gone before measuring. */
  settledSelectorHidden?: string;
  /** Why this route is on the list, in one sentence. */
  why: string;
  /**
   * The /map pin-ready record: how long a cold phone visit takes to paint a
   * tappable pin. It is not one of the four budgeted metrics, because it is not
   * a page cost - it is the moment the product becomes usable. The spec that
   * enforces it reads `targetMs` from here, so there is ONE owner of the number.
   */
  pinReady?: {
    path: string;
    targetMs: number;
    measuredMs: number;
    signal: string;
    viewport: { width: number; height: number };
    note: string;
  };
  /**
   * Every ceiling on this route that has ever been taken UP, and why.
   *
   * The law allows a raise in the commit that needs one, with the reason and a
   * measured figure. This is where that record lives, so the raise cannot be
   * made quietly: scripts/check-budget-ratchet.mjs refuses a raise with no
   * record, and refuses a record whose `from` disagrees with the base branch.
   */
  ceilingRaises?: Array<{
    metric: BudgetMetric;
    from: number;
    to: number;
    measured: number;
    why: string;
  }>;
} & Record<BudgetMetric, number>;

export type BudgetMethod = {
  browser: string;
  deviceScaleFactor: number;
  /** Unmeasured runs first, so a cold module load is not charged to the route. */
  warmupRuns: number;
  /** Measured runs per route. */
  measuredRuns: number;
  /**
   * Extra runs taken when a route could not measure itself.
   *
   * A median of 3 is only a median when the samples agree. A route whose
   * samples spread past sampleSpreadWarnPct on any metric is measured this
   * many times more and judged on the wider median. The extra runs are only
   * ever spent where the run reported it could not measure, so a quiet route
   * costs nothing and a noisy one is judged on more evidence rather than less.
   */
  resampleRuns?: number;
  /** Why the resample exists, kept beside the number for the next reader. */
  resampleWhy?: string;
  /**
   * And the second reason to spend them: a median this close to a ceiling, as a
   * percentage of the ceiling, is decided by one sample's jitter. The spread
   * rule asks whether the samples agreed with each other and is blind to where
   * they sit, so a route can agree with itself at 14 per cent and still read
   * 612 ms in one attempt and 956 ms in the next against a 900 ms ceiling.
   */
  resampleWithinCeilingPct?: number;
  aggregate: "median";
  /** CDP CPU throttle applied to every measured run. */
  cpuThrottleRate: number;
  /**
   * The network every measured run is taken over.
   *
   * Loopback is not a network: it has no round trip, so a route can hold every
   * byte ceiling and still lose the night to a waterfall nothing here would
   * see. The profile is NAMED and carries its own numbers, because "4G" means
   * different things in different tools and two figures are only comparable
   * when the wire under them was the same.
   */
  network: {
    profile: string;
    latencyMs: number;
    downloadBytesPerSecond: number;
    uploadBytesPerSecond: number;
    /**
     * No new request for this long counts as the network having gone quiet, so
     * every counted entry carries its final size. It is scaled to the PROFILE:
     * over a throttled wire an ordinary gap between two requests is longer than
     * a whole loopback load, and a window sized for loopback would call a route
     * finished in the middle of its own waterfall.
     */
    quietMs: number;
    /**
     * And how long a run waits for the last request to land before giving up.
     * A safety valve rather than a budget. Sized against the heaviest route on
     * this wire, which is /map.
     */
    drainCeilingMs: number;
    /**
     * A connection open longer than this is taken to be a STREAM rather than a
     * resource still arriving, so the wait stops rather than sitting out the
     * whole drain ceiling. /today holds one open for as long as the page lives,
     * and paying the ceiling for it cost 90 seconds on every single load.
     *
     * It is generous on purpose: any single resource that really takes this long
     * on this wire is itself the finding, and it will still be counted, because
     * the wait ends by NAMING what stayed open rather than by ignoring it.
     */
    streamAfterMs: number;
    why: string;
  };
  viewport: { width: number; height: number };
  /** Cross-origin requests are refused, so a run measures only what we ship. */
  thirdPartyBlocked: boolean;
  futureDeviceMigration: string;
  /**
   * Where the byte and request counts are cut, in words. Deliberately part of
   * the tracked config: two runs are only comparable if they stopped counting
   * at the same moment, and a time-based settle does not.
   */
  countedUpTo: string;
  /**
   * Whose clock cuts it. Deliberately tracked beside the words above, because
   * the words were already right and the CLOCK was the flake (#1314): a
   * boundary the harness times drifts by however long a visibility poll and a
   * CDP round trip took on a shared runner, and the page's post-paint idle
   * warmup crosses it or does not depending on that drift.
   */
  boundaryClock: "page";
  /**
   * How far apart a route's own samples may sit before the run says so. This
   * is the evidence #1314 asked for: if the spread WITHIN one run is as wide as
   * the spread BETWEEN runs, the method is the suspect rather than the code.
   * It is a warning and fails nothing.
   */
  sampleSpreadWarnPct: number;
  /**
   * And how wide that has to be in the metric's OWN units before it is worth
   * saying. A percentage alone is not information at these magnitudes: server
   * render sits at 3 to 19 ms here, so a single millisecond of scheduler jitter
   * reads as a 33% spread and every route warns on every run. A warning that
   * fires on everything is a warning nobody reads, so the gap must also be big
   * enough to matter against the tightest ceiling the metric has.
   */
  sampleSpreadFloors: Record<BudgetMetric, number>;
};

export type PerformanceBudgets = {
  note: string;
  method: BudgetMethod;
  routes: RouteBudget[];
};

export const PERFORMANCE_BUDGETS = budgetsJson as PerformanceBudgets;

/** One route's measured figures, in the same units as its budget. */
export type RouteMeasurement = Record<BudgetMetric, number>;

export type BudgetBreach = {
  path: string;
  metric: BudgetMetric;
  measured: number;
  budget: number;
  /** How far past the ceiling, as a whole percentage. */
  overBy: number;
};

/**
 * Every metric a run put past its ceiling, in route order then metric order.
 * A route with no measurement is NOT a pass: an unmeasured route is reported as
 * a breach of every metric, because a budget nothing checked is not a budget.
 */
export function findBudgetBreaches(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of BUDGET_METRICS) {
      const budget = route[metric];
      if (!measurement) {
        breaches.push({
          path: route.path,
          metric,
          measured: Number.NaN,
          budget,
          overBy: Number.NaN,
        });
        continue;
      }
      const value = measurement[metric];
      if (value <= budget) continue;
      breaches.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        overBy: Math.round(((value - budget) / budget) * 100),
      });
    }
  }
  return breaches;
}

/**
 * How far under a ceiling a route has to sit before the slack is worth banking.
 *
 * Slack does not stay slack. #1296 is the record of what happens otherwise: a
 * ceiling set generously, a route that quietly grew back into it, and nobody
 * able to say when. So a sweep that beats a ceiling by more than this names the
 * candidate, and somebody decides whether to take it down.
 */
export const RATCHET_SLACK_FRACTION = 0.15;

export type RatchetCandidate = {
  path: string;
  metric: BudgetMetric;
  measured: number;
  budget: number;
  /** How far under the ceiling, as a whole percentage. */
  underBy: number;
};

/**
 * Every metric a run beat by more than the slack fraction.
 *
 * This is a WARNING and nothing else: it edits no file and fails no build. A
 * ceiling comes down because a person decided it should, with the measurement
 * in front of them - the same rule the budget file's own note states.
 *
 * An unmeasured route is not a candidate: it is a breach, and
 * `findBudgetBreaches` already says so.
 */
export function findRatchetCandidates(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
  slackFraction: number = RATCHET_SLACK_FRACTION,
): RatchetCandidate[] {
  const candidates: RatchetCandidate[] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    if (!measurement) continue;
    for (const metric of BUDGET_METRICS) {
      const budget = route[metric];
      const value = measurement[metric];
      if (!Number.isFinite(value) || budget <= 0) continue;
      const slack = (budget - value) / budget;
      if (slack <= slackFraction) continue;
      candidates.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        underBy: Math.round(slack * 100),
      });
    }
  }
  return candidates;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

/**
 * The ratchet table a green run prints when there is slack to bank. Empty
 * string when every ceiling is snug, so a quiet sweep stays quiet.
 */
export function formatRatchetTable(candidates: readonly RatchetCandidate[]): string {
  if (candidates.length === 0) return "";
  const rows = candidates.map((candidate) => [
    candidate.path,
    BUDGET_METRIC_LABELS[candidate.metric],
    figure(candidate.measured),
    figure(candidate.budget),
    `-${candidate.underBy}%`,
  ]);
  const header = ["route", "metric", "measured", "budget", "under by"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The over-budget table a failing run prints. Empty string when nothing broke. */
export function formatBreachTable(breaches: readonly BudgetBreach[]): string {
  if (breaches.length === 0) return "";
  const rows = breaches.map((breach) => [
    breach.path,
    BUDGET_METRIC_LABELS[breach.metric],
    figure(breach.measured),
    figure(breach.budget),
    Number.isFinite(breach.overBy) ? `+${breach.overBy}%` : "-",
  ]);
  const header = ["route", "metric", "measured", "budget", "over by"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The full pass line a green run prints, so the numbers are in the log either way. */
export function formatMeasurementTable(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
): string {
  const rows: string[][] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of BUDGET_METRICS) {
      rows.push([
        route.path,
        BUDGET_METRIC_LABELS[metric],
        figure(measurement ? measurement[metric] : Number.NaN),
        figure(route[metric]),
      ]);
    }
  }
  const header = ["route", "metric", "measured", "budget"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/**
 * WHOSE CLOCK CUTS THE COUNT, and why it may not be the harness's.
 *
 * A route's cost is counted up to the moment it was interactive. That moment
 * has to be read off the PAGE, because the app deliberately warms the other tab
 * destinations once the foreground surface has painted (`lib/mapWarmup.ts`
 * schedules that on an idle callback with a 2000 ms timeout). Those requests are
 * off the critical path by design, so they must fall outside the count every
 * time, not most times.
 *
 * The harness cannot cut there. Playwright learns a selector is visible by
 * polling, and learns the page clock by a round trip after that, so its
 * "interactive" lands a poll interval plus a round trip late, and how late
 * depends on how loaded the runner is. #1314 is the record: `/today` measured
 * 43 requests and then 54 on identical code, a swing of about ten, which is the
 * size of one idle prefetch burst crossing the line.
 *
 * So the boundary is the page's own: the later of its `load` event and the
 * first frame on which its readiness gate was satisfied, both timestamped
 * in-page against the document's own time origin. The harness figure stays as
 * the fallback for a gate that never reported, and the source travels with the
 * sample so a run can say which clock it used.
 */
export type PerfBoundarySource = "page-ready" | "harness-ready";

export type PerfBoundaryInput = {
  /** `loadEventEnd` off the document's own navigation entry, in ms. */
  loadEventEndMs: number;
  /** First in-page frame on which the route's readiness gate held, in ms. */
  pageReadyAtMs: number;
  /** What the harness clocked, kept only as the fallback. */
  harnessReadyAtMs: number;
};

export type PerfBoundary = {
  boundaryMs: number;
  source: PerfBoundarySource;
};

export function resolveCountBoundary(input: PerfBoundaryInput): PerfBoundary {
  const { loadEventEndMs, pageReadyAtMs, harnessReadyAtMs } = input;
  const load = Number.isFinite(loadEventEndMs) && loadEventEndMs > 0 ? loadEventEndMs : 0;
  if (Number.isFinite(pageReadyAtMs)) {
    return { boundaryMs: Math.max(load, pageReadyAtMs), source: "page-ready" };
  }
  // The gate never reported. Rather than count to a moment we cannot defend,
  // fall back to the harness figure and SAY SO, so a drifting run is visible in
  // the log instead of quietly reading as a heavier route.
  return { boundaryMs: Math.max(load, harnessReadyAtMs), source: "harness-ready" };
}

export type SampleSpread = {
  min: number;
  max: number;
  /** How far the widest sample sits from the median, as a whole percentage. */
  spreadPct: number;
};

/**
 * How far apart one route's own samples sat. NaN in, NaN out: an unmeasurable
 * sample is not a narrow one.
 */
export function perfSampleSpread(values: readonly number[]): SampleSpread {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    return { min: Number.NaN, max: Number.NaN, spreadPct: Number.NaN };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const middle = median(values);
  if (middle <= 0) return { min, max, spreadPct: max === min ? 0 : Number.POSITIVE_INFINITY };
  return { min, max, spreadPct: Math.round(((max - min) / middle) * 100) };
}

export type SampleRow = Record<BudgetMetric, number> & {
  boundarySource?: PerfBoundarySource;
  /** Connections still open when the run stopped waiting. Reported, never failed on. */
  stillOpen?: readonly string[];
};

/**
 * Every sample of every route, printed beside the aggregate.
 *
 * #1314 asked for exactly this before choosing a fix: a run that logs only its
 * median cannot say whether a swing happened inside the run or between runs.
 */
export function formatSampleTable(
  samplesByPath: ReadonlyMap<string, readonly SampleRow[]>,
): string {
  const rows: string[][] = [];
  for (const [path, samples] of samplesByPath) {
    for (const metric of BUDGET_METRICS) {
      const values = samples.map((sample) => sample[metric]);
      const spread = perfSampleSpread(values);
      rows.push([
        path,
        BUDGET_METRIC_LABELS[metric],
        values.map(figure).join(" / "),
        figure(median(values)),
        Number.isFinite(spread.spreadPct) ? `${spread.spreadPct}%` : "-",
      ]);
    }
  }
  if (rows.length === 0) return "";
  const header = ["route", "metric", "samples", "median", "spread"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/**
 * The routes whose own samples sat further apart than the tracked warning
 * width, and every sample taken on the fallback clock. Both are facts about the
 * METHOD rather than about the code under test, so they are reported and
 * nothing fails on them.
 */
export function findMethodWarnings(
  samplesByPath: ReadonlyMap<string, readonly SampleRow[]>,
  warnPct: number = PERFORMANCE_BUDGETS.method.sampleSpreadWarnPct,
  floors: Record<BudgetMetric, number> = PERFORMANCE_BUDGETS.method.sampleSpreadFloors,
): string[] {
  const warnings: string[] = [];
  for (const [path, samples] of samplesByPath) {
    const open = [...new Set(samples.flatMap((sample) => sample.stillOpen ?? []))];
    if (open.length > 0) {
      warnings.push(
        `${path}: ${open.length} connection(s) were still open when the run stopped waiting, so ` +
          `they are streams rather than resources. They started well past the counting boundary ` +
          `and are not in the figures: ${open.join(", ")}`,
      );
    }
    const fallback = samples.filter((sample) => sample.boundarySource === "harness-ready").length;
    if (fallback > 0) {
      warnings.push(
        `${path}: ${fallback} of ${samples.length} sample(s) fell back to the harness clock, ` +
          `so the readiness gate never reported in-page. The figures are indicative, not comparable.`,
      );
    }
    for (const metric of BUDGET_METRICS) {
      const spread = perfSampleSpread(samples.map((sample) => sample[metric]));
      if (!Number.isFinite(spread.spreadPct) || spread.spreadPct <= warnPct) continue;
      const floor = floors[metric] ?? 0;
      if (spread.max - spread.min < floor) continue;
      warnings.push(
        `${path} ${BUDGET_METRIC_LABELS[metric]}: samples spread ${spread.spreadPct}% ` +
          `(${figure(spread.min)} to ${figure(spread.max)}), past the tracked ${warnPct}% ` +
          `width and the ${floor} floor.`,
      );
    }
  }
  return warnings;
}

/** The middle value of a sample, so one slow run cannot fail a green route. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
