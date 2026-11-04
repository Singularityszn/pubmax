import "server-only";

import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import { canAffectRoute } from "@/lib/nightSignalClaims";
import type { NightContext } from "@/lib/nightPlanning";
import { planUsesPintPrices, type PlanConstraintReport } from "@/lib/planGenerationDto";
import { PLAN_NEAR_STATION_METRES, planNearStationName } from "@/lib/planGenerationRanking";
import { formatGbp } from "@/lib/formatGbp";
import { planBudgetMissLine } from "@/lib/planBudgetCrawl";
import {
  PLAN_ACCESSIBILITY_NEEDS,
  type PlanAccessibilityNeed,
} from "@/lib/planIntake";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { DEFAULT_PLAN_STOP_COUNT, normalizePlanStopCount } from "@/lib/planStopCount";
import {
  planAccessEvidenceForVenue,
  planOpeningSchedulesForVenues,
  planPriceEvidenceForVenues,
} from "@/lib/planRouteEvidence.server";
import {
  cheapestGroundedPlanRoute,
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type AnchoredGroundedPlanRouteSelection,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
  type GroundedPlanRouteSelection,
  type SelectedGroundedPlanStop,
} from "@/lib/planRouteOptimizer";
import { pubStreetWalkKm } from "@/lib/pubWalkPairs.server";

export type ScoredPlanCandidate = {
  venue: ConciergeVenue;
  score: number;
  signalClaims: NightSignalClaim[];
  /** The chain that runs the pub, when one is known (lib/planRouteOptimizer.ts `oneStopPerOperator`). */
  operator?: string | null;
};

export type PlanGenerationSelection<T extends ScoredPlanCandidate> =
  | { ok: true; legacy: true; chosen: T[] }
  | {
      ok: true;
      legacy: false;
      chosen: T[];
      selection: Extract<GroundedPlanRouteSelection<T>, { ok: true }>;
      accessibilityEnforced: boolean;
    }
  | {
      ok: false;
      selection: Extract<GroundedPlanRouteSelection<T>, { ok: false }>;
      /** The must-have words the reader set, named in the refusal. Never a transport word. */
      mustHaves: string[];
      /**
       * Under a per-person budget, the cheapest fully priced route the search
       * found under every other rule, so the refusal can name it and its total.
       * Null without a budget, or when no route is fully priced.
       */
      cheapestRoute: PlanCheapestRoute | null;
    };

/** The cheapest route a budget refusal names, as the wire carries it. */
export type PlanCheapestRoute = {
  totalPence: number;
  stops: { venueId: string; venueName: string; pricePence: number; observedAt: string | null }[];
};

export type AnchoredPlanGenerationSelection<T extends ScoredPlanCandidate> =
  | {
      ok: true;
      outcome: "route";
      chosen: T[];
      selection: Extract<AnchoredGroundedPlanRouteSelection<T>, { outcome: "route" }>;
      accessibilityEnforced: boolean;
    }
  | {
      ok: true;
      outcome: "anchor-only";
      anchor: SelectedGroundedPlanStop<T>;
      anchorValue: T;
      accessibilityEnforced: boolean;
    }
  | { ok: false; reason: "ANCHOR_MISSING" };

/** Join canonical price, access, and opening evidence onto scored candidates. */
async function groundedRouteCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  now: number,
  usesPintPrices: boolean,
): Promise<GroundedPlanRouteCandidate<T>[]> {
  const venues = candidates.map(({ venue }) => venue);
  const [priceEvidence, openingSchedules] = await Promise.all([
    usesPintPrices ? planPriceEvidenceForVenues(venues, now) : Promise.resolve(new Map()),
    planOpeningSchedulesForVenues(venues),
  ]);
  return candidates.map((candidate) => ({
    value: candidate,
    venueId: candidate.venue.id,
    venueName: candidate.venue.name,
    score: candidate.score,
    lat: candidate.venue.lat,
    lng: candidate.venue.lng,
    price: priceEvidence.get(candidate.venue.id)
      ?? { pence: null, source: null, confidenceState: "unknown" as const },
    promoted: candidate.venue.promoted === true,
    avoidedByReviewedSignal: candidate.signalClaims.some((claim) =>
      canAffectRoute(claim) && claim.routeEffect === "avoid"),
    access: planAccessEvidenceForVenue(candidate.venue),
    openingSchedule: openingSchedules.get(candidate.venue.id) ?? null,
    operator: candidate.operator ?? null,
  }));
}

/**
 * The first `count` candidates in score order, taking one per known operator
 * before a second branch of any chain. The ungrounded path's version of the
 * optimizer's `oneStopPerOperator` rule.
 */
export function firstCandidatesPerOperator<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  count: number,
): T[] {
  const chosen: T[] = [];
  const repeats: T[] = [];
  const operators = new Set<string>();
  for (const candidate of candidates) {
    if (chosen.length === count) break;
    if (candidate.operator && operators.has(candidate.operator)) {
      repeats.push(candidate);
      continue;
    }
    if (candidate.operator) operators.add(candidate.operator);
    chosen.push(candidate);
  }
  if (chosen.length === count) return chosen;
  // Not enough distinct pubs: fill with the strongest repeats, in score order.
  const filled = new Set([...chosen, ...repeats.slice(0, count - chosen.length)]);
  return candidates.filter((candidate) => filled.has(candidate));
}

function requiredAccessibilityNeeds(
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
): PlanAccessibilityNeed[] {
  if (intake && !intake.handoff.skipped.includes("accessibility")) {
    return [...intake.handoff.accessibilityNeeds];
  }
  const contextNeeds = new Set(context.accessibility);
  return PLAN_ACCESSIBILITY_NEEDS.flatMap(({ id }) => contextNeeds.has(id) ? [id] : []);
}

function groundedConstraints(
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  accessibilityNeeds: readonly PlanAccessibilityNeed[],
  now: number,
): GroundedPlanRouteConstraints {
  return {
    exactArea: intake?.exactNightArea ?? null,
    accessibilityNeeds,
    budgetLimitPence: context.budgetLimitPence,
    budgetTier: context.budget,
    selectedDrinkPrice: !planUsesPintPrices(context),
    groupSize: context.groupSize,
    stopCount: normalizePlanStopCount(context.stopCount),
    transportConstraints: context.transportConstraints,
    routeWindow: intake?.routeWindow ?? null,
    now,
    streetWalkKm: pubStreetWalkKm,
    // Asking for a Spoons crawl is asking for one chain; otherwise one branch each.
    oneStopPerOperator: !context.wetherspoonsPreferred,
  };
}

/**
 * A tube or station word is a soft preference (scored in
 * lib/planGenerationRanking.ts). The report says what we could check: the
 * bundled station table is central London only, so a stop with no listed
 * station near it is unchecked, not far.
 */
function withTubeReport(
  report: PlanConstraintReport,
  context: NightContext,
  stops: readonly { lat: number; lng: number }[],
): PlanConstraintReport {
  if (!context.transportConstraints.includes("tube")) return report;
  const allNear = stops.length > 0 && stops.every((stop) => planNearStationName(stop.lat, stop.lng) !== null);
  return {
    ...report,
    hardConstraints: [
      ...report.hardConstraints,
      allNear
        ? { code: "tube_stations", status: "satisfied", message: `Tube: every stop is within ${PLAN_NEAR_STATION_METRES} m of a station.` }
        : { code: "tube_stations", status: "flagged", message: "Tube: we could not check station distance for these stops." },
    ],
  };
}

/** The must-haves a refusal names, in the words the reader would recognise. */
function mustHaveWords(
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  accessibilityNeeds: readonly PlanAccessibilityNeed[],
): string[] {
  const stopCount = normalizePlanStopCount(context.stopCount);
  return [
    ...PLAN_ACCESSIBILITY_NEEDS.flatMap(({ id, label }) => accessibilityNeeds.includes(id) ? [label.toLowerCase()] : []),
    ...(context.budgetLimitPence !== null ? [`a ${formatGbp(context.budgetLimitPence / 100)} budget`] : []),
    ...(intake?.routeWindow ? ["the time you picked"] : []),
    ...(intake?.exactNightArea ? ["the exact patch"] : []),
    ...(stopCount !== DEFAULT_PLAN_STOP_COUNT ? [`${stopCount} stops`] : []),
  ];
}

/** The refusal that names the must-haves the reader set, so they know what to drop. */
function planRouteRefusalMessage(stopCount: number, areaName: string, mustHaves: readonly string[]): string {
  if (mustHaves.length === 0) {
    return `No ${stopCount}-stop route in ${areaName} meets every must-have need with the information available.`;
  }
  const named = mustHaves.length > 1
    ? `${mustHaves.slice(0, -1).join(", ")} and ${mustHaves.at(-1)}`
    : mustHaves[0];
  return `No ${stopCount}-stop route in ${areaName} fits ${named} with the information we have. Try dropping one.`;
}

/**
 * The one sentence a refused generation reads. Under a budget, a fully priced
 * route that meets every other rule and still costs more means the budget is
 * what refused it, so the sentence names that route and its total (the £20
 * crawl, lib/planBudgetCrawl.ts). Otherwise it names the must-haves to drop.
 */
export function planGenerationRefusalMessage(
  context: Pick<NightContext, "stopCount" | "budgetLimitPence">,
  areaName: string,
  mustHaves: readonly string[],
  cheapestRoute: PlanCheapestRoute | null,
): string {
  const stopCount = normalizePlanStopCount(context.stopCount);
  if (cheapestRoute && context.budgetLimitPence !== null && cheapestRoute.totalPence > context.budgetLimitPence) {
    return planBudgetMissLine({
      stopCount,
      areaName,
      limitPence: context.budgetLimitPence,
      cheapest: cheapestRoute.stops,
    });
  }
  return planRouteRefusalMessage(stopCount, areaName, mustHaves);
}

/** The cheapest fully priced route under every rule but the budget, for the refusal. */
function cheapestRouteForRefusal<T>(
  grounded: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): PlanCheapestRoute | null {
  const cheapest = cheapestGroundedPlanRoute(grounded, constraints);
  if (!cheapest) return null;
  return {
    totalPence: cheapest.totalPence,
    stops: cheapest.stops.map((stop) => ({
      venueId: stop.venueId,
      venueName: stop.venueName,
      pricePence: stop.price.pence!,
      observedAt: stop.price.source?.observedAt ?? null,
    })),
  };
}

/** Join canonical evidence and run the hard-constraint optimizer. */
export async function selectPlanGenerationCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  now: number,
): Promise<PlanGenerationSelection<T>> {
  const accessibilityNeeds = requiredAccessibilityNeeds(context, intake);
  const hasContextHardConstraint = accessibilityNeeds.length > 0
    || context.budgetLimitPence !== null
    || normalizePlanStopCount(context.stopCount) !== DEFAULT_PLAN_STOP_COUNT;
  const legacy = (): PlanGenerationSelection<T> => {
    const count = normalizePlanStopCount(context.stopCount);
    const chosen = context.wetherspoonsPreferred
      ? candidates.slice(0, count)
      : firstCandidatesPerOperator(candidates, count);
    return { ok: true, legacy: true, chosen };
  };
  // A transport word alone still takes the grounded route, so its report can
  // say the walk was heard, but it never turns a route into a refusal.
  const transportOnly = !intake && !hasContextHardConstraint;
  if (transportOnly && context.transportConstraints.length === 0) return legacy();
  const grounded = await groundedRouteCandidates(candidates, now, planUsesPintPrices(context));
  const constraints = groundedConstraints(context, intake, accessibilityNeeds, now);
  const selection = selectGroundedPlanRoute(grounded, constraints);
  if (selection.ok) {
    return {
      ok: true,
      legacy: false,
      chosen: selection.stops.map((stop) => stop.value),
      selection: { ...selection, constraintReport: withTubeReport(selection.constraintReport, context, selection.stops) },
      accessibilityEnforced: accessibilityNeeds.length > 0,
    };
  }
  if (transportOnly) return legacy();
  return {
    ok: false,
    selection,
    mustHaves: mustHaveWords(context, intake, accessibilityNeeds),
    cheapestRoute: cheapestRouteForRefusal(grounded, constraints),
  };
}

/**
 * Run the anchor-pinned optimizer. Unlike the unanchored path this always joins
 * canonical evidence (the accepted Venue is grounded even without full intake)
 * and returns an honest route or one-Stop anchor-only outcome.
 */
export async function selectAnchoredPlanGenerationCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  now: number,
  anchorVenueId: string,
): Promise<AnchoredPlanGenerationSelection<T>> {
  const accessibilityNeeds = requiredAccessibilityNeeds(context, intake);
  const selection = selectAnchoredGroundedPlanRoute(
    await groundedRouteCandidates(candidates, now, planUsesPintPrices(context)),
    groundedConstraints(context, intake, accessibilityNeeds, now),
    anchorVenueId,
  );
  if (!selection.ok) return { ok: false, reason: "ANCHOR_MISSING" };
  const accessibilityEnforced = accessibilityNeeds.length > 0;
  return selection.outcome === "anchor-only"
    ? {
        ok: true,
        outcome: "anchor-only",
        anchor: selection.anchor,
        anchorValue: selection.anchor.value,
        accessibilityEnforced,
      }
    : {
        ok: true,
        outcome: "route",
        chosen: selection.stops.map((stop) => stop.value),
        selection: { ...selection, constraintReport: withTubeReport(selection.constraintReport, context, selection.stops) },
        accessibilityEnforced,
      };
}
