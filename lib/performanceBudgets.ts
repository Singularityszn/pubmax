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
  /**
   * This route ANSWERS A REDIRECT rather than a document, and this is where it
   * sends the reader.
   *
   * The sweep opens each route with `waitUntil: "load"` and a browser follows a
   * 3xx, so without this a redirecting route's row silently measures the page it
   * lands on, under a ceiling written for the page it used to be. /onboarding
   * did exactly that: it answers 307 to "/" now and ships no document, and the
   * next sweep read the homepage's 45 requests against the 41 that used to buy
   * an almost empty first-run shell.
   *
   * A declared route is measured through the redirect itself, so its ceilings
   * are the redirect's own cost. The target keeps its own row, which is what
   * stops the page falling out of the budget altogether.
   */
  redirectsTo?: string;
  /**
   * This route has been MEASURED wide on this rig, so the ordinary three
   * samples cannot decide it. See RouteNoiseRecord.
   */
  noisy?: RouteNoiseRecord;
} & Record<BudgetMetric, number>;

/**
 * A ROUTE THAT CANNOT MEASURE ITSELF IN THREE, RECORDED RATHER THAN GUESSED.
 *
 * A ceiling is only a ceiling when the number under it is repeatable, and on
 * these runners four routes are not: the 6 September sweep put their LCP
 * samples 37 to 51 per cent apart, past this method's own 12 per cent width,
 * and PR #1604 and PR #1611 both went red on routes they had not touched. The
 * answer is more evidence, never a bigger ceiling, so a marked route takes a
 * second discarded warm-up navigation and twice the resample budget, and is
 * judged on the median of seven.
 *
 * The mark is EVIDENCE and not a preference: it carries the metric that was
 * measured wide and the widest spread recorded, so it can be argued with, and
 * it may be taken off the day a route measures narrow again. It touches no
 * ceiling and can only ever ADD samples.
 */
export type RouteNoiseRecord = {
  /** The metric or metrics this route was measured wide on. */
  metrics: BudgetMetric[];
  /** The widest spread recorded on this rig, as a whole percentage. */
  measuredSpreadPct: number;
  why: string;
};

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
  /** And why the on-the-line half exists, and why its band reads both ways. */
  resampleWithinCeilingWhy?: string;
  /**
   * THE NOISE FLOOR: what a route carrying a `noisy` record spends instead.
   *
   * `noisyWarmupRuns` is its discarded navigations, and `noisyResampleRuns` its
   * resample budget, so a marked route is judged on the median of
   * `measuredRuns + noisyResampleRuns` rather than of `measuredRuns +
   * resampleRuns`. Both are absolute counts rather than deltas, because a
   * reader of this block should not have to do arithmetic to learn what a route
   * actually costs. Neither moves a ceiling and neither is spent on an unmarked
   * route, so a quiet sweep costs exactly what it did before.
   */
  noisyWarmupRuns?: number;
  noisyResampleRuns?: number;
  noisyFloorWhy?: string;
  /**
   * And the second reason to spend them: a median this close to a ceiling, as a
   * percentage of the ceiling, is decided by one sample's jitter. The spread
   * rule asks whether the samples agreed with each other and is blind to where
   * they sit, so a route can agree with itself at 14 per cent and still read
   * 612 ms in one attempt and 956 ms in the next against a 900 ms ceiling.
   *
   * The band is SYMMETRIC about the ceiling - `|median - ceiling| <= ceiling *
   * pct` - and `medianSitsOnTheLine` is the one owner of that arithmetic. It
   * used to be one-sided, firing on everything from a hair under the line to a
   * route three times over it, which spent extra samples exactly and only where
   * they could turn a red green.
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
 * A metric whose samples could not decide its own ceiling.
 *
 * It is reported and excluded from the breach list rather than failed, and the
 * figures that made it undecidable travel with it, so a reader can argue with
 * the call instead of taking it on trust.
 */
export type UnmeasuredMetric = {
  path: string;
  metric: BudgetMetric;
  budget: number;
  /** The median that would have been judged. */
  median: number;
  min: number;
  max: number;
  /** How far the samples sat apart, as a whole percentage. */
  spreadPct: number;
};

/** What one sweep decided, and what it could not. */
export type BudgetVerdict = {
  breaches: BudgetBreach[];
  unmeasured: UnmeasuredMetric[];
};

/**
 * THE CLOCKS, and the only metrics an undecided verdict may ever cover.
 *
 * `serverRenderMs` and `lcpMs` read the machine the sweep ran on. A loaded box
 * moves them without a line of the route changing, which is the whole of the
 * flake this rule exists for.
 *
 * `requests` and `jsDecodedKB` are COUNTS of work the page chose to do, and
 * they are judged on their median always. Samples that disagree there did not
 * measure a busy runner: they measured a route that loaded different things on
 * different navigations, and that is the finding rather than the noise. A
 * change pulling an extra chunk on some loads reads as requests 44, 60 and 62
 * against a ceiling of 46, and a gate that excused it would ship the
 * regression. So a count is never excluded, however wide it ran.
 */
const CLOCK_METRICS: readonly BudgetMetric[] = ["serverRenderMs", "lcpMs"];

function metricKey(path: string, metric: BudgetMetric): string {
  return `${path}\u0000${metric}`;
}

/**
 * A VERDICT IS UNANIMOUS OR IT IS NOT A VERDICT.
 *
 * `findBudgetBreaches` judges the median it is handed, which is right when the
 * samples behind that median agree. When they do not, the median is whichever
 * way the runner happened to lean, and converting it into a breach turns a
 * loaded box into a red build on a diff that did not touch the route. Job
 * 103319591915 and its re-run on the IDENTICAL commit 3ebac98ac shared three of
 * their eleven breached routes: `/today` measured 480 ms in one and 272 ms in
 * the other against a 300 ms ceiling, and the method block reported the samples
 * behind both spreading past 90 per cent. The sweep already SAID so - the
 * warning simply changed nothing.
 *
 * So the samples decide whether their own median may be read as a verdict. THE
 * WHOLE RULE, and the one place it is written down: a CLOCK is undecided when
 * all three of these hold, and judged on its median otherwise.
 *
 *   a. ITS SAMPLES STRADDLE THE CEILING: at least one met it and at least one
 *      went past it. Samples of which NOT ONE met the ceiling are over budget
 *      however wide they are, because no median that evidence allows is under,
 *      and that is the half that keeps a genuinely slow route failing. Samples
 *      that all sit under it have decided a pass the same way: server render
 *      runs 3 to 19 ms against a 150 ms ceiling here, so a millisecond of
 *      scheduler jitter reads as a wide spread on a row nothing could put in
 *      doubt, and naming those would bury the straddling rows this report
 *      exists for.
 *   b. THEY DISAGREE PAST `sampleSpreadWarnPct`. Samples that agree with each
 *      other have measured the route, and their median is the verdict however
 *      close to the line it sits.
 *   c. THE EXCESS FITS INSIDE THE SPREAD THAT IS SUPPOSED TO EXPLAIN IT:
 *      `median - budget <= (max - min) / 2`. A route running 1200 ms on six of
 *      seven samples with one warm 290 ms sample straddles a 300 ms ceiling and
 *      is far wider than the tracked width, but its median is 900 ms over
 *      against a half-spread of 455: noise that size did not put that median
 *      there, so it is a breach. This compares two figures the run already
 *      measured and adds no tracked number.
 *
 * And only a CLOCK is ever asked. See `CLOCK_METRICS`: a count that disagrees
 * across samples is a route doing different work, not a loaded box.
 *
 * The anchor is THE CEILING ITSELF rather than a band around it. The first cut
 * let the fastest sample sit `resampleWithinCeilingPct` over the line, which
 * excluded samples of 320, 800 and 1200 against a 300 ms ceiling: a median two
 * thirds over budget, laundered by a fastest sample 10 ms inside the band. A
 * run in which no sample ever met the ceiling is a breach whatever its spread.
 * `medianSitsOnTheLine` still owns that band, because how many samples to BUY
 * is a different question from what the samples already bought may say.
 *
 * The metric's `sampleSpreadFloors` entry is deliberately NOT asked here. It
 * exists so `findMethodWarnings` does not fire on every route on every run,
 * where a percentage alone is not information; a spread wide enough to straddle
 * the ceiling already supplies that relevance. Asking the floor as well would
 * leave `/rounds` red at 308 against 300 off samples running 240 to 328, which
 * is the shape of red this whole rule exists to stop.
 *
 * WHY EXCLUDE RATHER THAN RESAMPLE UNTIL THE SPREAD CLOSES. Extra samples can
 * only move a median, so a loop that stops when the spread closes stops exactly
 * when the noise stopped showing: it launders the measurement rather than
 * taking it, which is the objection the captain upheld on 7 September against
 * the one-sided rescue band. It is also a retry with extra steps, and this
 * sweep declares `retries: 0` for that reason. And the sweep's timeout is
 * derived from `plannedNavigations`, a worst case no until-condition has.
 * The route still spends its ordinary resample budget first: this decides only
 * what the evidence it bought is allowed to say.
 */
function undecidedMetric(
  samples: readonly SampleRow[],
  metric: BudgetMetric,
  budget: number,
  method: BudgetMethod,
): Omit<UnmeasuredMetric, "path" | "metric" | "budget"> | null {
  if (samples.length < 2 || !CLOCK_METRICS.includes(metric)) return null;
  const values = samples.map((sample) => sample[metric]);
  const spread = perfSampleSpread(values);
  if (!Number.isFinite(spread.spreadPct) || spread.spreadPct <= method.sampleSpreadWarnPct) {
    return null;
  }
  if (spread.min > budget || spread.max <= budget) return null;
  const middle = median(values);
  if (middle - budget > (spread.max - spread.min) / 2) return null;
  return { median: middle, min: spread.min, max: spread.max, spreadPct: spread.spreadPct };
}

/**
 * The sweep's verdict: what went past a ceiling, and what could not say.
 *
 * THE REPORT READS BOTH WAYS. Every route and every metric is asked whether its
 * own samples decided their ceiling, rather than only the rows
 * `findBudgetBreaches` already flagged, so a wide straddling run is named
 * whichever side of the line its median happened to fall on. The same evidence
 * may not read as a clean pass in one run and as undecided in the next: that
 * one-sided shape is what the captain refused on 7 September for the resample
 * band, and it is refused here too.
 *
 * NO VERDICT MOVES WITH IT. A metric whose median is under its ceiling still
 * passes, and the gate can still only ever fail on a breach. An undecided
 * ceiling is reported and left off the breach list. A route with no samples at
 * all is untouched: it is still a breach of every metric, because a budget
 * nothing checked is not a budget.
 */
export function judgeBudgets(
  budgets: readonly RouteBudget[],
  measured: ReadonlyMap<string, RouteMeasurement>,
  samplesByPath: ReadonlyMap<string, readonly SampleRow[]>,
  method: BudgetMethod = PERFORMANCE_BUDGETS.method,
): BudgetVerdict {
  const unmeasured: UnmeasuredMetric[] = [];
  const undecided = new Set<string>();
  for (const route of budgets) {
    const samples = samplesByPath.get(route.path) ?? [];
    for (const metric of BUDGET_METRICS) {
      const budget = route[metric];
      const figures = undecidedMetric(samples, metric, budget, method);
      if (!figures) continue;
      undecided.add(metricKey(route.path, metric));
      unmeasured.push({ path: route.path, metric, budget, ...figures });
    }
  }
  const breaches = findBudgetBreaches(budgets, measured).filter(
    (breach) => !undecided.has(metricKey(breach.path, breach.metric)),
  );
  return { breaches, unmeasured };
}

/**
 * How far under a ceiling a route has to sit before the slack is worth banking.
 *
 * Slack does not stay slack. #1296 is the record of what happens otherwise: a
 * ceiling set generously, a route that quietly grew back into it, and nobody
 * able to say when. So a sweep that beats a ceiling by more than this names the
 * candidate, and somebody decides whether to take it down.
 */
const RATCHET_SLACK_FRACTION = 0.15;

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

/**
 * The candidates a run is ALLOWED to offer for banking.
 *
 * One log may not call a ceiling unreadable and offer its slack in the same
 * breath. Banking takes a ceiling DOWN off the very median the run refused to
 * trust, and the fast samples that made it look generous become the next
 * sweep's red. LCP samples of 200, 250 and 1000 ms against a 300 ms ceiling are
 * the shape: they straddle the line, so the run could not decide it, while
 * their median of 250 reads as 17 per cent of slack worth banking. Take that
 * ceiling to 250 and the 1000 ms sample is the next red. So every undecided
 * metric is dropped here. `findRatchetCandidates` stays blind to the verdict
 * and pure, and this is the one place the two are put together.
 */
export function bankableRatchetCandidates(
  candidates: readonly RatchetCandidate[],
  unmeasured: readonly UnmeasuredMetric[],
): RatchetCandidate[] {
  const undecided = new Set(unmeasured.map((entry) => metricKey(entry.path, entry.metric)));
  return candidates.filter(
    (candidate) => !undecided.has(metricKey(candidate.path, candidate.metric)),
  );
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

function excess(value: number): string {
  if (!Number.isFinite(value)) return "not measured";
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/**
 * One report table, rendered the one way: every column padded to its widest
 * cell, a rule under the header and no trailing space. Every table this module
 * prints goes through here, so a new one cannot drift from the others.
 */
function table(header: readonly string[], rows: readonly string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
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
  return table(["route", "metric", "measured", "budget", "under by"], rows);
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
  return table(["route", "metric", "measured", "budget", "over by"], rows);
}

/**
 * The table naming every ceiling the run could not decide. Empty string when
 * every figure decided itself, so a clean sweep stays quiet.
 *
 * It is LOUD on purpose. An excluded metric is not a pass: it is a ceiling this
 * run did not measure, and the next reader has to be able to see which one and
 * how wide the evidence was.
 *
 * It carries the EXCESS beside the range, because a route whose excess over its
 * ceiling is smaller than its own jitter cannot be decided by a single sweep,
 * so it is reported unmeasured every time rather than failed, and a row that
 * keeps appearing there is the signal to spend real evidence on that route. The
 * figure a reader needs to see returning is how far over the line the median
 * sat, so it is printed rather than left to be worked out.
 */
export function formatUnmeasuredTable(unmeasured: readonly UnmeasuredMetric[]): string {
  if (unmeasured.length === 0) return "";
  const rows = unmeasured.map((entry) => [
    entry.path,
    BUDGET_METRIC_LABELS[entry.metric],
    figure(entry.median),
    figure(entry.budget),
    excess(entry.median - entry.budget),
    `${figure(entry.min)} to ${figure(entry.max)}`,
    `${entry.spreadPct}%`,
  ]);
  return table(
    ["route", "metric", "median", "budget", "excess", "samples ran", "spread"],
    rows,
  );
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
  return table(["route", "metric", "measured", "budget"], rows);
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
 * The ceilings a resample decision reads: a budget row, or any subset of one.
 * A metric with no ceiling here simply does not vote.
 */
export type RouteCeilings = Partial<Record<BudgetMetric, number>>;

/**
 * WHEN A ROUTE IS MEASURED AGAIN, AND THE ONE OWNER OF THAT DECISION.
 *
 * A median of three is only a median when the samples agree, and a verdict
 * taken within a hair of a ceiling is decided by jitter rather than by the
 * code. Both are reasons to spend more samples, and both are asked here rather
 * than in the browser helper, so the rule is unit-tested without a browser and
 * no perf spec can drift apart from another on it.
 *
 * Nothing in this file decides pass or fail from these predicates. They only
 * ever ADD samples; findBudgetBreaches still judges the median it is handed.
 */

/**
 * True when a route's own samples sat further apart than the tracked width AND
 * further apart than the metric's own floor - the same two tests
 * findMethodWarnings applies when it reports a run as unmeasurable.
 */
export function samplesDisagree(
  samples: readonly SampleRow[],
  method: BudgetMethod,
): boolean {
  if (samples.length === 0) return false;
  return BUDGET_METRICS.some((metric) => {
    const spread = perfSampleSpread(samples.map((sample) => sample[metric]));
    if (!Number.isFinite(spread.spreadPct) || spread.spreadPct <= method.sampleSpreadWarnPct) {
      return false;
    }
    return spread.max - spread.min >= (method.sampleSpreadFloors[metric] ?? 0);
  });
}

/**
 * True when a median landed close enough to a ceiling that one sample's jitter
 * decides the verdict. THE BAND IS SYMMETRIC AROUND THE CEILING, and that is
 * the whole of this rule.
 *
 * The first cut fired on any median at or above `ceiling * (1 - margin)`, which
 * has no upper edge: it bought extra samples on every figure from a hair under
 * the line all the way out to a route three times over it, and never on one
 * sitting comfortably under. Extra samples can only move a median, so a trigger
 * shaped like that spends evidence exactly and only where it can turn a red
 * into a green - it is a thumb on the scale rather than a measurement, and the
 * captain's decision (7 September 2026) is that it be symmetric.
 *
 * So the band is `|median - ceiling| <= ceiling * margin`. A figure just under
 * the line and a figure just over it buy the same evidence, and a route far
 * over its ceiling buys none: that is a regression rather than jitter, and the
 * spread rule above is still there for the run where a box genuinely stalled.
 * The change makes the gate STRICTER, never looser: it removes rescue attempts
 * and adds none.
 */
export function medianSitsOnTheLine(
  samples: readonly SampleRow[],
  ceilings: RouteCeilings,
  method: BudgetMethod,
): boolean {
  const margin = method.resampleWithinCeilingPct;
  if (!margin || samples.length === 0) return false;
  return BUDGET_METRICS.some((metric) => {
    const ceiling = ceilings[metric];
    if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling <= 0) return false;
    const figure = median(samples.map((sample) => sample[metric]));
    if (!Number.isFinite(figure)) return false;
    return Math.abs(figure - ceiling) <= ceiling * (margin / 100);
  });
}

/**
 * How many navigations one route costs: its discarded warm-ups, and the
 * resample budget it may spend if `routeNeedsMoreEvidence` fires.
 *
 * It is a pure read of the route's own `noisy` record against the method
 * block, so the sweep, the UX lane report and the sweep's own timeout all get
 * the same answer from one place.
 */
export type RouteRunPlan = {
  warmupRuns: number;
  resampleRuns: number;
  /** True when this route is spending the noise floor rather than the ordinary budget. */
  noisy: boolean;
};

export function resolveRouteRunPlan(
  route: { noisy?: RouteNoiseRecord },
  method: BudgetMethod,
): RouteRunPlan {
  const ordinary = {
    warmupRuns: method.warmupRuns,
    resampleRuns: method.resampleRuns ?? 0,
    noisy: false,
  };
  if (!route.noisy) return ordinary;
  return {
    warmupRuns: method.noisyWarmupRuns ?? ordinary.warmupRuns,
    resampleRuns: method.noisyResampleRuns ?? ordinary.resampleRuns,
    noisy: true,
  };
}

/**
 * The worst case a whole sweep can cost, in navigations. The sweep's own
 * timeout reads it, because a noise floor that is not in the timeout is a
 * sweep that times out rather than a sweep that measures.
 */
export function plannedNavigations(
  routes: readonly { noisy?: RouteNoiseRecord }[],
  method: BudgetMethod,
): number {
  return routes.reduce((total, route) => {
    const plan = resolveRouteRunPlan(route, method);
    return total + plan.warmupRuns + method.measuredRuns + plan.resampleRuns;
  }, 0);
}

/**
 * Either reason to spend the resample budget, asked once.
 *
 * The budget is passed in rather than read off the method, because a route
 * carrying a `noisy` record spends `noisyResampleRuns` instead - and a route
 * with no budget at all is never asked the question, so a method that declares
 * no resample takes exactly the runs it says it takes.
 */
export function routeNeedsMoreEvidence(
  samples: readonly SampleRow[],
  ceilings: RouteCeilings,
  method: BudgetMethod,
  resampleBudget: number,
): boolean {
  if (!Number.isFinite(resampleBudget) || resampleBudget <= 0) return false;
  return samplesDisagree(samples, method) || medianSitsOnTheLine(samples, ceilings, method);
}

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
  return table(["route", "metric", "samples", "median", "spread"], rows);
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
  const upper = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
}
