import {
  BUDGET_METRIC_LABELS,
  median,
  resolveRouteRunPlan,
  type BudgetMethod,
  type BudgetMetric,
  type RouteBudget,
  type RouteNoiseRecord,
} from "./performanceBudgets";

/**
 * DID THE BRANCH MAKE THAT ROUTE SLOWER, OR IS THIS BOX SLOWER THAN THE ONE
 * THAT SET THE CEILING?
 *
 * This module is the arithmetic half of the answer. It decides nothing about
 * pass or fail: `judgeBudgets` still decides the breach list from the medians
 * and samples it is handed, that list still fails the build, and no ceiling
 * anywhere is read here. What
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
 * WHAT ONE A/B IS ALLOWED TO SPEND, AND WHY IT IS COUNTED IN NAVIGATIONS.
 *
 * A mass breach is the very signature of a slow box: on 11 September 2026 one
 * job measured 43 of 44 budgeted routes about a third slower. Measuring every
 * one of them against a second build walks the job into its own wall, and a
 * job cancelled at the wall uploads nothing, so the evidence is lost in exactly
 * the case it was built for. A partial answer that arrives beats a whole one
 * that does not.
 *
 * The budget counts NAVIGATIONS across both arms rather than routes, because
 * routes do not cost the same: a route carrying a noise record takes two
 * discarded navigations and seven counted samples, more than twice what a quiet
 * route takes, so eight of them would spend more than twice what eight quiet
 * ones spend. The figure is read off the method block through the A/B's own
 * per-route cost rather than typed here: it is what eight ordinary routes cost,
 * on both arms.
 */
const PERF_AB_BUDGET_ROUTES = 8;

/** Branch and base. Every A/B cost is paid twice, once on each. */
export const PERF_AB_ARMS = 2;

/**
 * A route as this module COSTS it.
 *
 * The noise record decides how many samples it takes, `redirectsTo` decides
 * whether it loads a page at all, and `settledSelectorHidden` decides whether
 * one sample waits on a second readiness gate. All three change what the route
 * really costs, so all three are read here rather than assumed away.
 */
export type AbRoutePlan = Pick<RouteBudget, "path"> & {
  noisy?: RouteNoiseRecord;
  redirectsTo?: string;
  settledSelectorHidden?: string;
};

/**
 * COUNTED SAMPLES PER ARM, HONOURING THE ROUTE'S OWN NOISE FLOOR.
 *
 * A route marked noisy is judged on the median of seven here exactly as the
 * sweep judges it, because three samples cannot decide a route whose samples
 * were recorded 37 to 51 per cent apart: the two arms would differ by the
 * spread rather than by the code, and the A/B would answer its one question
 * wrongly on the very routes it was built to explain. An unmarked route keeps
 * its three, because the resample budget is spent where a run said it could not
 * measure, and a quiet route never said that.
 */
export function abSamplesPerArm(route: AbRoutePlan, method: BudgetMethod): number {
  const plan = resolveRouteRunPlan(route, method);
  return method.measuredRuns + (plan.noisy ? plan.resampleRuns : 0);
}

/**
 * What measuring one route costs the A/B, in navigations across both arms.
 *
 * A REDIRECT COSTS NONE. It is measured with a single request rather than a
 * page load, which is why neither the warm-ups nor the counted samples charge
 * it one, and pricing it at eight here would let the budget drop a budgeted
 * redirect for a cost it never pays: the instrument refusing to look at a route
 * it was built for. The plan and the spend say the same thing in one place.
 */
export function abNavigationsForRoute(route: AbRoutePlan, method: BudgetMethod): number {
  if (route.redirectsTo) return 0;
  const plan = resolveRouteRunPlan(route, method);
  return PERF_AB_ARMS * (plan.warmupRuns + abSamplesPerArm(route, method));
}

/**
 * WHAT ONE ROUTE COSTS THE CLOCK, which is not what it costs the budget.
 *
 * The budget counts navigations and a redirect makes none, so it is priced at
 * nothing there and rightly so. The admission check asks a different question:
 * how long this route will take at the pace this run has actually managed. A
 * redirect still takes six requests and real seconds, and pricing that at zero
 * left the run with no pace at all, so the route AFTER a redirect was admitted
 * however little time remained, which is the rule NEVER BEGIN WHAT CANNOT
 * FINISH being skipped. Work units count every request and every load the route
 * will make, on both arms.
 */
export function abWorkUnitsForRoute(route: AbRoutePlan, method: BudgetMethod): number {
  const plan = resolveRouteRunPlan(route, method);
  const perArm = (route.redirectsTo ? 0 : plan.warmupRuns) + abSamplesPerArm(route, method);
  return PERF_AB_ARMS * perArm;
}

/**
 * The navigation budget one A/B may spend across both arms.
 *
 * It is eight ordinary routes priced at what the A/B ITSELF spends on one,
 * rather than at what `plannedNavigations` charges the sweep: the sweep buys a
 * resample wherever a run said it could not measure, and the A/B never buys one
 * on a quiet route, so reading the sweep's figure made the budget half again
 * the size its own sentence claimed.
 */
export function abNavigationBudget(method: BudgetMethod): number {
  return PERF_AB_BUDGET_ROUTES * abNavigationsForRoute({ path: "" }, method);
}

/**
 * The test's own deadline, from the navigations it will actually spend and what
 * ONE navigation may legitimately take in this harness.
 *
 * The allowance is not a figure typed here. A navigation waits up to the
 * harness's route-ready ceiling for the gate to hold and up to the method's own
 * drain ceiling for the network to go quiet, so those two numbers are what a
 * slow route is allowed to cost. A smaller allowance would fire on exactly the
 * kind of route this instrument is ever asked about, which is the one that has
 * something to say.
 *
 * The A/B binds EACH of its own navigations at `abNavigationAllowanceMs` as
 * well, because a `page.goto` bounded only by the test's total is a single hung
 * load free to eat the job's whole wall and take the upload with it. Bounded,
 * that load fails ITS SAMPLE, the arm reads NOT COMPARED under the rule already
 * in force, and the run carries on and still reports.
 */
export function abNavigationAllowanceMs(
  method: BudgetMethod,
  routeReadyTimeoutMs: number,
): number {
  return routeReadyTimeoutMs + method.network.drainCeilingMs;
}

/**
 * WHAT ONE COUNTED SAMPLE MAY TAKE, WHICH IS MORE THAN ONE NAVIGATION.
 *
 * `abNavigationAllowanceMs` bounds the `page.goto` and nothing else. A sample
 * then waits for the readiness gate to hold, waits AGAIN for a loading
 * affordance to clear on a route that declares one, and only then waits for the
 * network to go quiet. Every bound sized off the navigation alone is therefore
 * half the work it is waiting on, which is how a kill lands mid-sample.
 */
export function abSampleAllowanceMs(
  route: Pick<AbRoutePlan, "settledSelectorHidden">,
  method: BudgetMethod,
  routeReadyTimeoutMs: number,
): number {
  return (
    abNavigationAllowanceMs(method, routeReadyTimeoutMs) +
    routeReadyTimeoutMs +
    (route.settledSelectorHidden ? routeReadyTimeoutMs : 0) +
    method.network.drainCeilingMs
  );
}

/** The worst one sample can cost on any budgeted route, gates and drain included. */
export function abWorstSampleAllowanceMs(
  method: BudgetMethod,
  routeReadyTimeoutMs: number,
): number {
  return abSampleAllowanceMs({ settledSelectorHidden: "declared" }, method, routeReadyTimeoutMs);
}

export function abTimeoutMs(
  navigations: number,
  method: BudgetMethod,
  routeReadyTimeoutMs: number,
): number {
  return Math.max(navigations, 1) * abWorstSampleAllowanceMs(method, routeReadyTimeoutMs);
}

/**
 * THE JOB'S OWN WALL, MIRRORED. `timeout-minutes` on the `performance-budget`
 * job in `.github/workflows/ci.yml`. Move that number and this one moves with
 * it, because everything below is a share of it.
 */
export const PERF_AB_JOB_WALL_MS = 55 * 60_000;

/**
 * WHAT THE ARTIFACT UPLOAD KEEPS OF THE WALL, whatever the measuring wants.
 *
 * A job cancelled at the wall never runs the step that uploads this report, so
 * evidence gathered with no room to hand it over is evidence lost. A share of
 * the wall rather than a figure typed beside it, so the next person changing
 * `timeout-minutes` changes this with it: about five minutes of fifty-five.
 */
export function abUploadReserveMs(jobWallMs: number = PERF_AB_JOB_WALL_MS): number {
  return Math.floor(jobWallMs / 11);
}

/**
 * WHAT THE MEASURING KEEPS BACK SO ITS OWN STOP ALWAYS BEATS THE KILL.
 *
 * `scripts/perf-ab.mjs` bounds the measuring subprocess at the wall less the
 * upload's share, and the spec inside it stops its loop on the same wall and
 * the same share. Equal to the millisecond, the outer kill can land ON the
 * graceful stop rather than behind it, and everything after the loop dies with
 * it: the final report write that alone records the routes the deadline never
 * started, both arms closing, and the print. The graceful path has to win, so
 * the spec stops this much earlier than the process that would kill it.
 *
 * THE MARGIN CANNOT BE SHORTER THAN THE WORK IT WAITS ON. The deadline is asked
 * BEFORE a sample, and that sample may then take a whole SAMPLE allowance, not
 * merely a navigation: the load, the readiness gate, a second gate on a route
 * that declares one, and the drain. A margin sized off the navigation alone is
 * half of that, so the kill lands while the load is still in flight, which is
 * the very loss it was added to prevent. It is therefore the WORST sample this
 * suite can take, plus a fifth of the upload's share for the two arms closing
 * and the last report write. Both terms are read off the method rather than
 * typed here, so the method and `timeout-minutes` still move every figure
 * between them.
 */
export function abTeardownMarginMs(
  method: BudgetMethod,
  routeReadyTimeoutMs: number,
  jobWallMs: number = PERF_AB_JOB_WALL_MS,
): number {
  return (
    abWorstSampleAllowanceMs(method, routeReadyTimeoutMs) +
    Math.floor(abUploadReserveMs(jobWallMs) / 5)
  );
}

/**
 * HOW LONG THE A/B MAY SPEND MEASURING: WHAT IS LEFT, NEVER A FIXED SHARE.
 *
 * The per-navigation allowance above is what ONE navigation may take, and it
 * stays generous on purpose: cutting a slow navigation short turns the thing
 * being measured into a timeout. What that allowance cannot do is bound the
 * whole run, and a run bounded only by the job's wall is a run GitHub cancels.
 *
 * The wall carries FOUR things in order: the branch build and the sweep, the
 * merge-base install and its build, this measurement, and the artifact upload.
 * The first three are not bounded by anything this module can see, and on the
 * slow box this instrument exists for they are exactly what overruns, so the
 * measuring takes THE TIME LEFT rather than a quarter that may already be gone:
 * a share of a wall somebody else has spent is not a share. An elapsed time
 * past the wall yields no measuring at all rather than a negative deadline,
 * which is the honest answer, because the run has nothing left to spend.
 *
 * The teardown margin above comes off as well, so the spec's own stop always
 * arrives before the script's kill and the report it writes last survives.
 */
export function abMeasuringDeadlineMs(input: {
  /** What the sweep and the merge-base build have already spent of the wall. */
  elapsedMs?: number;
  method: BudgetMethod;
  routeReadyTimeoutMs: number;
  jobWallMs?: number;
}): number {
  const jobWallMs = input.jobWallMs ?? PERF_AB_JOB_WALL_MS;
  return Math.max(
    0,
    jobWallMs -
      (input.elapsedMs ?? 0) -
      abUploadReserveMs(jobWallMs) -
      abTeardownMarginMs(input.method, input.routeReadyTimeoutMs, jobWallMs),
  );
}

/**
 * Whether the measuring deadline has passed. Asked before each route, between
 * the two arms and between samples, because a deadline consulted only at the
 * top of a route bounds when the LAST ROUTE STARTS rather than when the run
 * ends, and one slow route can outlast the job's whole wall on its own.
 */
export function abDeadlineReached(startedAt: number, now: number, deadlineMs: number): boolean {
  return now - startedAt >= deadlineMs;
}

/**
 * NEVER BEGIN WHAT CANNOT FINISH.
 *
 * A route admitted with minutes left and a plan worth more than that spends
 * them and hands over NOT COMPARED, so the time buys nothing at all. This asks
 * the other way round: what this route's WHOLE plan costs against what is left.
 *
 * The price per navigation is THIS RUN'S OWN measured pace rather than a figure
 * typed here or the harness's worst case. The worst case would admit nothing at
 * all (one quiet route's eight navigations at the per-navigation allowance
 * outlasts the deadline by itself), and a typed figure is a guess that drifts
 * from the box it is meant to describe. Before anything has been measured there
 * is no pace to read, so the first route is admitted: a run that measures
 * nothing has nothing to report.
 */
export function abRouteFitsDeadline(input: {
  /** What this route costs, in work units across both arms. */
  workUnits: number;
  /** Milliseconds left on the measuring deadline. */
  remainingMs: number;
  /** This run's own pace so far, or null before it has measured anything. */
  observedMsPerWorkUnit: number | null;
}): boolean {
  if (input.remainingMs <= 0) return false;
  if (input.observedMsPerWorkUnit === null) return true;
  return input.workUnits * input.observedMsPerWorkUnit <= input.remainingMs;
}

export type AbBreachSelection = {
  /** Distinct routes the sweep breached. */
  breachedRoutes: number;
  /** The breached metrics it measures, worst-first by route. */
  breaches: AbBreach[];
  /** Routes the budget could not reach, worst first, named in the report. */
  unreached: string[];
  /**
   * Breached paths carrying no row in the budget file. They were not left out
   * by any budget: they could not be opened or costed at all, and the breach
   * list disagreeing with `perf/route-budgets.json` is a finding of its own.
   */
  unbudgeted: string[];
  /** Navigations across both arms this selection spends. */
  navigations: number;
  /** The budget it was filled against. */
  budget: number;
};

/** How far one measured figure sits past its own ceiling, against that ceiling. */
function excessOverCeiling(breach: AbBreach): number {
  if (!Number.isFinite(breach.measured) || !Number.isFinite(breach.budget)) return 0;
  if (breach.budget > 0) return (breach.measured - breach.budget) / breach.budget;
  return breach.measured;
}

/**
 * The breached routes this A/B measures, worst first, inside its budget.
 *
 * Worst first because a budget that bites has to leave out the breaches that
 * explain least, and because a job killed part way through has by then measured
 * the ones an author asks about first. A route is measured only when its WHOLE
 * plan fits in what remains: half a route's samples is a median nobody can
 * defend, so the route is left out and named instead.
 */
export function selectAbBreaches(
  breaches: readonly AbBreach[],
  routes: readonly AbRoutePlan[],
  method: BudgetMethod,
  budget: number = abNavigationBudget(method),
): AbBreachSelection {
  const byPath = new Map(routes.map((route) => [route.path, route]));
  const groups = new Map<string, { breaches: AbBreach[]; worst: number; order: number }>();
  for (const breach of breaches) {
    const group = groups.get(breach.path) ?? {
      breaches: [],
      worst: Number.NEGATIVE_INFINITY,
      order: groups.size,
    };
    group.breaches.push(breach);
    group.worst = Math.max(group.worst, excessOverCeiling(breach));
    groups.set(breach.path, group);
  }

  const worstFirst = [...groups.entries()].sort(
    ([, left], [, right]) => right.worst - left.worst || left.order - right.order,
  );

  const measured: AbBreach[] = [];
  const unreached: string[] = [];
  const unbudgeted: string[] = [];
  let navigations = 0;
  for (const [path, group] of worstFirst) {
    const route = byPath.get(path);
    // A breached path with no budgeted route cannot be opened, let alone costed.
    if (!route) {
      unbudgeted.push(path);
      continue;
    }
    const cost = abNavigationsForRoute(route, method);
    if (navigations + cost > budget) {
      unreached.push(path);
      continue;
    }
    navigations += cost;
    measured.push(...group.breaches);
  }

  return {
    breachedRoutes: groups.size,
    breaches: measured,
    unreached,
    unbudgeted,
    navigations,
    budget,
  };
}

/**
 * What the report says about its own scope, before any figure.
 *
 * The breached count comes FIRST and the measured count second, so nobody reads
 * six A/B rows as six breaches. A budget that bit says so on its own line and
 * NAMES what it could not reach: a truncated diagnosis that says so is useful,
 * one that hides its truncation is not.
 *
 * Both counts are what the run ACTUALLY did, never what the selection planned.
 * A run the deadline stopped after two of eight routes said "eight measured"
 * two lines above "PARTIAL: 2 of 8", and reported its whole navigation budget
 * as spent when it had spent a quarter of it. The first sentence is the one an
 * author quotes.
 */
export function formatAbScopeLines(
  selection: AbBreachSelection,
  routesMeasured: number,
  navigationsSpent: number,
): string[] {
  const lines = [
    `${selection.breachedRoutes} route(s) breached; ${routesMeasured} measured ` +
      `against the merge base, spending ${navigationsSpent} navigation(s) across both arms.`,
  ];
  // The planned budget is its OWN sentence. Joined to the spend with a "so", a
  // deadline-stopped run read as though a budget of 64 had left a route out
  // while the run spent 12, which is two accountings in one clause.
  if (selection.unreached.length > 0) {
    lines.push(
      `The navigation budget is ${selection.budget} across both arms and the selection ` +
        `planned ${selection.navigations}, so the budget left out ` +
        `${selection.unreached.join(", ")}. A mass breach is itself the signature of a ` +
        "slow box.",
    );
  }
  if (selection.unbudgeted.length > 0) {
    lines.push(
      `${selection.unbudgeted.join(", ")} breached with no row in perf/route-budgets.json, ` +
        "so no arm could open or cost it. The breach list and the budget file disagree, " +
        "which is a finding of its own.",
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
  /**
   * What the SWEEP measured for this route and metric, which is the figure that
   * put it on the breach list. The verdict never reads it; the runner-drift
   * label does, because drift is a fact about THAT figure.
   */
  sweepMeasured: number;
  /** The samples this branch's build took, in the order they were taken. */
  branch: readonly number[];
  /** The samples the merge-base build took, interleaved with the branch's. */
  base: readonly number[];
  /**
   * What each arm's plan asked for. A verdict needs the WHOLE plan on BOTH
   * arms: a median of one sample wearing the same label as a median of seven is
   * the laundering this lane exists to stop.
   */
  plannedSamples: number;
};

/**
 * BRANCH SLOWER is a regression this run can defend. NOT SLOWER THAN BASE is
 * the evidence that a red route is the box rather than the branch. NOT COMPARED
 * is an arm that did not complete its plan, whether it measured nothing or
 * measured some of it: absence of evidence convicts nobody and clears nobody,
 * and the next run measures again.
 */
type AbVerdict = "BRANCH SLOWER" | "NOT SLOWER THAN BASE" | "NOT COMPARED";

export type AbComparison = {
  path: string;
  metric: BudgetMetric;
  budget: number;
  branchMedian: number;
  baseMedian: number;
  /** The sweep's own figure for this route and metric, printed beside the rest. */
  sweepMeasured: number;
  /** Samples that survived on each arm, and what the plan asked of each. */
  branchSamples: number;
  baseSamples: number;
  plannedSamples: number;
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
 *
 * A ROUTE'S OWN NOISE RECORD DOES NOT WIDEN THIS BAND, and reinstating that
 * would be the wrong instrument for the question. `measuredSpreadPct` records
 * how far one arm's RAW samples sat apart WITHIN that arm; this band judges the
 * gap BETWEEN two arms. The A/B has already answered arm noise twice by the
 * time it gets here: a marked route is judged on the median of seven through
 * its own run plan, and the navigations are interleaved with the lead
 * alternating so drift shared by both arms cancels in the difference. A gap
 * that survives both of those is not jitter, and charging the raw single-sample
 * spread on top of a median that already absorbed it counts the same noise
 * twice, on the four routes least able to measure themselves.
 */
export function abNoiseBandPct(method: BudgetMethod): number {
  return method.sampleSpreadWarnPct;
}

/**
 * HOW BIG THE GAP MUST BE IN THE METRIC'S OWN UNITS, AND WHY THIS IS NOT THE
 * REFUSAL OF 7 SEPTEMBER TURNED ROUND.
 *
 * A percentage alone is not information at these magnitudes. Server render sits
 * in single-digit milliseconds on this rig, so 8 ms against 9 ms is 12 per cent
 * and BRANCH SLOWER off one millisecond of scheduler jitter. A WRONG BRANCH
 * SLOWER is the most expensive thing this instrument can print, because
 * somebody then hunts a regression that is not there. `samplesDisagree` pairs
 * the same percentage with the same floors for the same reason.
 *
 * The floors were REFUSED for a different question and that refusal stands. On
 * the CEILING question, a 250 ms floor against a 300 ms ceiling would have
 * demanded that samples disagree by 83 per cent of the ceiling before a run
 * could admit it was unsure: the right constant asked the wrong question. Here
 * the question is the one the floors were made for, whether a GAP between two
 * arms is wide enough to mean anything at all. Do not "fix" one to match the
 * other.
 *
 * THE FLOOR IS CAPPED AGAINST THE ROUTE'S OWN CEILING, and that cap is the one
 * fraction this method already states about a ceiling:
 * `resampleWithinCeilingPct`, the symmetric band `medianSitsOnTheLine` treats
 * as jitter on either side of a ceiling. A gap SMALLER than the band a ceiling
 * is already judged jitter within cannot be evidence of a regression against
 * that same ceiling; a gap LARGER than it plainly can. Uncapped, the 250 ms
 * lcpMs floor sat above the whole 300 ms ceiling of /crawls and /today, so a
 * real 220 ms regression read NOT SLOWER THAN BASE and was then named runner
 * drift, which exonerates the branch in the very words the standing law uses to
 * re-run a red check. No floor and no ceiling moved for this: the cap is taken
 * per route, at the moment of the comparison.
 */
export function abNoiseFloor(
  metric: BudgetMetric,
  method: BudgetMethod,
  ceiling: number,
): number {
  const metricFloor = method.sampleSpreadFloors[metric] ?? 0;
  const ceilingShare = ((method.resampleWithinCeilingPct ?? 0) / 100) * ceiling;
  if (!Number.isFinite(ceiling) || ceiling <= 0 || ceilingShare <= 0) return metricFloor;
  return Math.min(metricFloor, ceilingShare);
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
 *
 * THE WHOLE RULE, IN PLAIN WORDS. BRANCH SLOWER costs BOTH tests and neither
 * one alone.
 *
 * The RELATIVE test asks whether the gap is wide as a proportion. Its band is
 * the method's `sampleSpreadWarnPct` for EVERY route without exception. A
 * route's own noise record does not touch this comparison: that record measures
 * spread WITHIN one arm, and `abNoiseBandPct` says at length why answering a
 * between-arms question with it counts the same noise twice.
 *
 * The ABSOLUTE test asks whether the gap is wide in the metric's own units. Its
 * floor is the smaller of the method's `sampleSpreadFloors` entry and the
 * route's own ceiling times `resampleWithinCeilingPct` (`abNoiseFloor`),
 * because a gap smaller than the band a ceiling is already judged jitter within
 * cannot be evidence against that ceiling, and because the uncapped 250 ms
 * lcpMs floor sits above the whole 300 ms ceiling of /crawls.
 *
 * Together they close the false-verdict class the floors opened: the cap stops
 * a 220 ms regression on a 300 ms ceiling being exonerated, and the floor still
 * stops a millisecond of server render being convicted. Do not take one test
 * for the other, and do not widen either one.
 */
export function compareArms(
  pairs: readonly AbRoutePair[],
  method: BudgetMethod,
): AbComparison[] {
  return pairs.map((pair) => {
    const band = abNoiseBandPct(method);
    const branchSamples = pair.branch.filter((value) => Number.isFinite(value));
    const baseSamples = pair.base.filter((value) => Number.isFinite(value));
    const branchMedian = branchSamples.length > 0 ? median(branchSamples) : Number.NaN;
    const baseMedian = baseSamples.length > 0 ? median(baseSamples) : Number.NaN;
    // A VERDICT COSTS THE WHOLE PLAN ON BOTH ARMS. An arm that lost samples is
    // not a smaller version of an arm that did not: two of three on the
    // noisiest route in the table can print runner drift off one surviving
    // figure, which is the phrase the standing law asks for before a red check
    // is re-run. No answer said out loud beats a confident wrong one.
    const complete =
      branchSamples.length >= pair.plannedSamples && baseSamples.length >= pair.plannedSamples;
    const compared = complete && Number.isFinite(branchMedian) && Number.isFinite(baseMedian);
    const exactPct = compared ? relativeDeltaPct(branchMedian, baseMedian) : Number.NaN;
    const deltaPct = compared ? Math.round(exactPct) : Number.NaN;
    const slower =
      exactPct > band &&
      branchMedian - baseMedian >= abNoiseFloor(pair.metric, method, pair.budget);
    const verdict: AbVerdict = !compared
      ? "NOT COMPARED"
      : slower
        ? "BRANCH SLOWER"
        : "NOT SLOWER THAN BASE";
    return {
      path: pair.path,
      metric: pair.metric,
      budget: pair.budget,
      branchMedian,
      baseMedian,
      sweepMeasured: pair.sweepMeasured,
      branchSamples: branchSamples.length,
      baseSamples: baseSamples.length,
      plannedSamples: pair.plannedSamples,
      deltaPct,
      verdict,
      // RUNNER DRIFT IS A FACT ABOUT THE SWEEP'S FIGURE, not about the A/B's.
      // The clearest drift there is reads /messages at 888 against a 572
      // ceiling in the sweep and 540 against a base of 545 minutes later in the
      // same job: judged on the A/B's own median that case could never be
      // named, which is the one reading the words exist for.
      runnerDrift:
        verdict === "NOT SLOWER THAN BASE" &&
        Number.isFinite(pair.budget) &&
        pair.sweepMeasured > pair.budget,
    };
  });
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

/** A duration that names a real quantity, whether it is minutes or the last seconds. */
function formatAbDuration(milliseconds: number): string {
  if (milliseconds >= 60_000) return `${Math.round(milliseconds / 60_000)} minute(s)`;
  return `${Math.round(milliseconds / 1_000)} second(s)`;
}

function signedPct(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value}%`;
}

/** What backed each median, on every row, whatever the verdict. */
function sampleCounts(row: AbComparison): string {
  return `${row.branchSamples}/${row.plannedSamples} vs ${row.baseSamples}/${row.plannedSamples}`;
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
    sampleCounts(row),
    signedPct(row.deltaPct),
    row.verdict,
  ]);
  const header = ["route", "metric", "ceiling", "branch", "base", "samples", "delta", "verdict"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((line) => (line[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ").trimEnd();
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
      `branch ${figure(row.branchMedian)} from ${row.branchSamples} of ${row.plannedSamples} ` +
      `samples, base ${figure(row.baseMedian)} from ${row.baseSamples} of ${row.plannedSamples}, ` +
      `ceiling ${figure(row.budget)}`;
    if (row.verdict === "NOT COMPARED") {
      return (
        `${row.path} ${metric}: an arm did not complete its plan (${figures}), so this run ` +
        "says nothing about it."
      );
    }
    if (row.verdict === "BRANCH SLOWER") {
      return `${row.path} ${metric}: ${signedPct(row.deltaPct)} against the merge base on this box (${figures}): BRANCH SLOWER.`;
    }
    if (row.runnerDrift) {
      return (
        `${row.path} ${metric}: the sweep measured ${figure(row.sweepMeasured)} past this ` +
        `ceiling and the A/B measured no slower than the merge base on this box ` +
        `(${figures}, ${signedPct(row.deltaPct)}): runner drift.`
      );
    }
    return `${row.path} ${metric}: ${signedPct(row.deltaPct)} against the merge base on this box (${figures}): NOT SLOWER THAN BASE.`;
  });
}

/**
 * THE WHOLE REPORT, BUILT FROM WHAT HAS BEEN MEASURED SO FAR.
 *
 * The A/B writes it after EVERY route rather than once at the end, because the
 * box slow enough to abort the run is the box whose evidence matters most: a
 * report assembled only after the last route discards the routes that did
 * measure, and the selection is ordered worst first precisely so a run cut
 * short has already measured the ones an author asks about. A report that is
 * still partial says so in its own first lines.
 */
export function formatAbReport(input: {
  branchOrigin: string;
  baseOrigin: string;
  head: string;
  selection: AbBreachSelection;
  rows: readonly AbComparison[];
  routesMeasured: number;
  routesSelected: number;
  /** Navigations this run actually spent across both arms. */
  navigationsSpent: number;
  /** Routes the deadline never let start. */
  deadlineNotStarted?: readonly string[];
  /** Routes the deadline stopped part way through, whose rows read NOT COMPARED. */
  deadlineStoppedPartWay?: readonly string[];
  /** What the measuring was given, for the sentence that names the deadline. */
  deadlineMs?: number;
}): string {
  const partial = input.routesMeasured < input.routesSelected;
  const notStarted = input.deadlineNotStarted ?? [];
  const stoppedPartWay = input.deadlineStoppedPartWay ?? [];
  const bounded = Number.isFinite(input.deadlineMs ?? Number.POSITIVE_INFINITY);
  const deadlineSpent = formatAbDuration(input.deadlineMs ?? 0);
  return [
    "[perf-ab] the branch against its merge base: same box, same job, navigations interleaved",
    `[perf-ab] branch ${input.branchOrigin}  base ${input.baseOrigin}  head ${input.head || "local"}`,
    ...formatAbScopeLines(input.selection, input.routesMeasured, input.navigationsSpent).map(
      (line) => `[perf-ab] ${line}`,
    ),
    ...(partial
      ? [
          `[perf-ab] PARTIAL: ${input.routesMeasured} of ${input.routesSelected} selected ` +
            "route(s) measured when this was written.",
        ]
      : []),
    // A hand run races no wall, so it must not be told a deadline it never had.
    ...(bounded
      ? []
      : ["[perf-ab] No job wall was handed over, so this run measured unbounded."]),
    // A route never opened and a route stopped half way are different facts. One
    // heading over both puts "did not reach" above a table carrying that very
    // route's partial rows.
    ...(notStarted.length > 0
      ? [
          `[perf-ab] The DEADLINE ended this run, not the navigation budget: ` +
            `${deadlineSpent} of measuring fits inside the job's wall with room ` +
            `for the upload, so it NEVER STARTED ${notStarted.join(", ")}.`,
        ]
      : []),
    ...(stoppedPartWay.length > 0
      ? [
          `[perf-ab] The DEADLINE STOPPED ${stoppedPartWay.join(", ")} PART WAY THROUGH, so ` +
            "those rows carry fewer samples than the plan asked for and read NOT COMPARED.",
        ]
      : []),
    "",
    formatAbTable(input.rows),
    "",
    ...formatAbVerdictLines(input.rows).map((line) => `  - ${line}`),
    "",
    "[perf-ab] This moves no ceiling and fails nothing: the breach table is still the gate.",
  ].join("\n");
}
