import { haversineKm } from "@/lib/haversine";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import type { Budget, NightAreaSlug } from "@/lib/nightPlanning";
import type {
  PlanConstraintReport,
  PlanStopConstraintFlag,
} from "@/lib/planGenerationDto";
import {
  OPENING_EVIDENCE_FRESH_DAYS,
  accessNeedSatisfied,
  assessOpeningSchedule,
  priceEvidenceUsableForCeiling,
  type OpeningAssessment,
  type PlanAccessEvidence,
  type PlanOpeningSchedule,
  type PlanPriceEvidence,
} from "@/lib/planRouteEvidence";

export const PLAN_STOP_MINUTES = 50;
export const PLAN_WALKING_KMH = 4.8;
export const PLAN_TRANSFER_UNCERTAINTY_MINUTES = 5;
export const MAX_PLAN_ROUTE_SEGMENT_KM = 1.6;
export const MAX_PLAN_ROUTE_WALKING_KM = 3;

export type PlanVisitWindow = { startsAt: string; endsAt: string };
export type PlanRouteTiming = {
  visitWindows: readonly [PlanVisitWindow, PlanVisitWindow, PlanVisitWindow] | [];
  straightLineWalkingKm: number;
  walkingMinutes: number;
  transferUncertaintyMinutes: number;
  scheduledRouteMinutes: number;
};

export type { PlanConstraintReport, PlanStopConstraintFlag } from "@/lib/planGenerationDto";

export type GroundedPlanRouteCandidate<T> = {
  value: T;
  venueId: string;
  venueName: string;
  score: number;
  lat: number;
  lng: number;
  price: PlanPriceEvidence;
  promoted: boolean;
  avoidedByReviewedSignal: boolean;
  access: PlanAccessEvidence;
  openingSchedule: PlanOpeningSchedule | null;
};

export type GroundedPlanRouteConstraints = {
  exactArea: NightAreaSlug | null;
  accessibilityNeeds: readonly PlanAccessibilityNeed[];
  budgetLimitPence: number | null;
  budgetTier: Budget | null;
  groupSize: number | null;
  transportConstraints: readonly string[];
  routeWindow: { startsAt: string; endsAt: string } | null;
  now: number;
};

export type SelectedGroundedPlanStop<T> = GroundedPlanRouteCandidate<T> & {
  position: number;
  visitWindow: PlanVisitWindow | null;
  opening: OpeningAssessment;
  constraintFlags: PlanStopConstraintFlag[];
};

export type GroundedPlanRouteSelection<T> =
  | {
      ok: true;
      stops: readonly [SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>];
      alternatives: readonly [
        readonly SelectedGroundedPlanStop<T>[],
        readonly SelectedGroundedPlanStop<T>[],
        readonly SelectedGroundedPlanStop<T>[],
      ];
      timing: PlanRouteTiming;
      constraintReport: PlanConstraintReport;
    }
  | {
      ok: false;
      eligibleCandidateCount: number;
      rejected: { safety: number; exclusions: number; accessibility: number; budgetEvidence: number; budgetCeiling: number };
    };

function distanceKm<T>(left: GroundedPlanRouteCandidate<T>, right: GroundedPlanRouteCandidate<T>): number {
  return haversineKm([left.lng, left.lat], [right.lng, right.lat]);
}

function legWalkingMinutes(km: number): number {
  return Math.ceil((km / PLAN_WALKING_KMH) * 60);
}

export function routeTiming<T>(
  route: readonly [GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>],
  routeWindow: GroundedPlanRouteConstraints["routeWindow"],
): PlanRouteTiming | null {
  const firstKm = distanceKm(route[0], route[1]);
  const secondKm = distanceKm(route[1], route[2]);
  const distance = firstKm + secondKm;
  if (firstKm > MAX_PLAN_ROUTE_SEGMENT_KM || secondKm > MAX_PLAN_ROUTE_SEGMENT_KM || distance > MAX_PLAN_ROUTE_WALKING_KM) {
    return null;
  }
  const walkingMinutes = legWalkingMinutes(firstKm) + legWalkingMinutes(secondKm);
  const uncertainty = PLAN_TRANSFER_UNCERTAINTY_MINUTES * 2;
  const scheduledRouteMinutes = PLAN_STOP_MINUTES * 3 + walkingMinutes + uncertainty;
  if (!routeWindow) {
    return {
      visitWindows: [],
      straightLineWalkingKm: distance,
      walkingMinutes,
      transferUncertaintyMinutes: uncertainty,
      scheduledRouteMinutes,
    };
  }
  let cursor = Date.parse(routeWindow.startsAt);
  const deadline = Date.parse(routeWindow.endsAt);
  if (!Number.isFinite(cursor) || !Number.isFinite(deadline)) return null;
  const visits: PlanVisitWindow[] = [];
  for (let position = 0; position < 3; position += 1) {
    const endsAt = cursor + PLAN_STOP_MINUTES * 60_000;
    visits.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(endsAt).toISOString() });
    if (position < 2) {
      const km = position === 0 ? firstKm : secondKm;
      cursor = endsAt + (legWalkingMinutes(km) + PLAN_TRANSFER_UNCERTAINTY_MINUTES) * 60_000;
    }
  }
  if (Date.parse(visits[2].endsAt) > deadline) return null;
  return {
    visitWindows: visits as [PlanVisitWindow, PlanVisitWindow, PlanVisitWindow],
    straightLineWalkingKm: distance,
    walkingMinutes,
    transferUncertaintyMinutes: uncertainty,
    scheduledRouteMinutes,
  };
}

type EvaluatedRoute<T> = {
  route: readonly [GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>];
  timing: PlanRouteTiming;
  opening: readonly [OpeningAssessment, OpeningAssessment, OpeningAssessment];
  score: number;
  key: string;
};

function evaluateRoute<T>(
  route: readonly [GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  if (constraints.budgetLimitPence !== null) {
    if (!route.every((candidate) => priceEvidenceUsableForCeiling(candidate.price))) return null;
    if (route.reduce((total, candidate) => total + candidate.price.pence!, 0) > constraints.budgetLimitPence) return null;
  }
  const timing = routeTiming(route, constraints.routeWindow);
  if (!timing) return null;
  const visits = timing.visitWindows;
  if (!route.every((candidate, position) => constraints.accessibilityNeeds.every((need) =>
    accessNeedSatisfied(candidate.access, need, visits[position]?.startsAt ?? null)))) return null;
  const opening = route.map((candidate, position) => assessOpeningSchedule(
    candidate.openingSchedule,
    visits[position] ?? null,
    constraints.now,
  )) as [OpeningAssessment, OpeningAssessment, OpeningAssessment];
  if (visits.length > 0 && opening.some((assessment) => assessment.state !== "listed_open")) return null;
  return {
    route,
    timing,
    opening,
    score: route.reduce((total, candidate) => total + candidate.score, 0),
    key: route.map((candidate) => candidate.venueId).join("|"),
  };
}

function flagsFor(opening: OpeningAssessment, hasVisit: boolean): PlanStopConstraintFlag[] {
  if (!hasVisit) return [];
  if (opening.state === "unknown") {
    return [{ code: "opening_hours_unconfirmed", message: opening.warning ?? "Opening hours are unconfirmed." }];
  }
  return opening.warning
    ? [{ code: "recurring_hours_exception_warning", message: opening.warning }]
    : [];
}

function selectedStops<T>(evaluation: EvaluatedRoute<T>): [
  SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>,
] {
  return evaluation.route.map((candidate, position) => ({
    ...candidate,
    position,
    visitWindow: evaluation.timing.visitWindows[position] ?? null,
    opening: evaluation.opening[position],
    constraintFlags: flagsFor(evaluation.opening[position], Boolean(evaluation.timing.visitWindows[position])),
  })) as [SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>];
}

function report<T>(evaluation: EvaluatedRoute<T>, constraints: GroundedPlanRouteConstraints): PlanConstraintReport {
  const dated = evaluation.timing.visitWindows.length === 3;
  return {
    version: 1,
    source: "plan-intake-v1",
    hardConstraints: [
      {
        code: "safety",
        status: "satisfied",
        message: constraints.routeWindow
          ? "Stops with a reviewed avoid signal overlapping any part of the route window were conservatively excluded."
          : "Stops with an active reviewed avoid signal were excluded.",
      },
      { code: "exclusions", status: "satisfied", message: "Excluded and promoted venues were not eligible." },
      {
        code: "transport_feasibility",
        status: "satisfied",
        message: `Travel time uses ${PLAN_WALKING_KMH} km/h direct-distance walking plus ${PLAN_TRANSFER_UNCERTAINTY_MINUTES} minutes uncertainty per leg; pavement routing is not claimed.`,
      },
      ...(constraints.exactArea ? [{
        code: "exact_area" as const,
        status: "satisfied" as const,
        message: "Every stop is within the selected patch.",
      }] : []),
      ...(constraints.accessibilityNeeds.length ? [{
        code: "accessibility" as const,
        status: "satisfied" as const,
        message: "Every stop has checked information for each access need at its visit time.",
      }] : []),
      ...(constraints.budgetLimitPence !== null ? [{
        code: "budget_ceiling" as const,
        status: "satisfied" as const,
        message: "The attributable, non-stale recorded one-pint-per-stop total is within the per-person ceiling.",
      }] : []),
      ...(dated ? [{
        code: "opening_hours" as const,
        status: "flagged" as const,
        message: "Recurring weekly schedules list every stop open; holiday and one-off exceptions are not confirmed and must be checked.",
      }] : []),
    ],
    softRelaxations: [
      ...((constraints.groupSize ?? 0) >= 6 ? [{
        code: "group_fit_unverified" as const,
        message: "Group size did not shape the order because we do not have checked capacity details.",
      }] : []),
      ...(constraints.budgetTier === "value"
        && constraints.budgetLimitPence === null
        && evaluation.route.some((candidate) => candidate.price.pence === null) ? [{
          code: "value_price_evidence_incomplete" as const,
          message: "The value preference was applied, but at least one selected stop has no attributable recorded pint price.",
        }] : []),
    ],
  };
}

function better<T>(candidate: EvaluatedRoute<T>, incumbent: EvaluatedRoute<T> | null): boolean {
  if (!incumbent) return true;
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
  if (candidate.timing.straightLineWalkingKm !== incumbent.timing.straightLineWalkingKm) {
    return candidate.timing.straightLineWalkingKm < incumbent.timing.straightLineWalkingKm;
  }
  return candidate.key.localeCompare(incumbent.key, "en-GB") < 0;
}

const ROUTE_PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

function hasCurrentAttributableOpeningSchedule(
  schedule: PlanOpeningSchedule | null,
  now: number,
): boolean {
  if (!schedule || schedule.venueListedOpen !== true) return false;
  const { source } = schedule;
  if (
    !source
    || typeof source.label !== "string"
    || !source.label.trim()
    || typeof source.url !== "string"
    || !/^https?:\/\//.test(source.url)
    || typeof source.observedAt !== "string"
  ) return false;
  const observedAt = Date.parse(source.observedAt);
  if (!Number.isFinite(observedAt)) return false;
  const ageDays = (now - observedAt) / 86_400_000;
  return ageDays >= 0 && ageDays <= OPENING_EVIDENCE_FRESH_DAYS;
}

function bestRouteFromCombination<T>(
  combination: readonly [
    GroundedPlanRouteCandidate<T>,
    GroundedPlanRouteCandidate<T>,
    GroundedPlanRouteCandidate<T>,
  ],
  constraints: GroundedPlanRouteConstraints,
  incumbent: EvaluatedRoute<T> | null,
): EvaluatedRoute<T> | null {
  let best = incumbent;
  for (const permutation of ROUTE_PERMUTATIONS) {
    const evaluated = evaluateRoute([
      combination[permutation[0]],
      combination[permutation[1]],
      combination[permutation[2]],
    ], constraints);
    if (evaluated && better(evaluated, best)) best = evaluated;
  }
  return best;
}

/**
 * Visit candidate triples in descending score-bound order. Once an incumbent
 * exists, a branch whose three best remaining scores cannot match it is
 * discarded. A surviving unordered triple still checks every ordering, so the
 * walking-distance and lexical route tie-breaks remain exact.
 */
function findBestRoute<T>(
  eligible: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): EvaluatedRoute<T> | null {
  const ranked = [...eligible].sort((left, right) => right.score - left.score
    || left.venueId.localeCompare(right.venueId, "en-GB"));
  const combination: GroundedPlanRouteCandidate<T>[] = [];
  let best: EvaluatedRoute<T> | null = null;

  const visit = (start: number, partialScore: number): void => {
    const remaining = 3 - combination.length;
    if (remaining === 0) {
      best = bestRouteFromCombination(combination as [
        GroundedPlanRouteCandidate<T>,
        GroundedPlanRouteCandidate<T>,
        GroundedPlanRouteCandidate<T>,
      ], constraints, best);
      return;
    }

    for (let index = start; index <= ranked.length - remaining; index += 1) {
      let upperScore = partialScore + ranked[index].score;
      for (let offset = 1; offset < remaining; offset += 1) {
        upperScore += ranked[index + offset].score;
      }
      if (best && upperScore < best.score) break;

      combination.push(ranked[index]);
      visit(index + 1, partialScore + ranked[index].score);
      combination.pop();
    }
  };

  visit(0, 0);
  return best;
}

type RouteRejectionCounts = { safety: number; exclusions: number; accessibility: number; budgetEvidence: number; budgetCeiling: number };

/** Apply the hard per-candidate eligibility filter, tallying rejection reasons. */
function routeEligibleCandidates<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
  rejected: RouteRejectionCounts,
): GroundedPlanRouteCandidate<T>[] {
  const eligible = [...candidates]
    .sort((left, right) => left.venueId.localeCompare(right.venueId, "en-GB"))
    .filter((candidate) => {
      if (candidate.promoted) { rejected.exclusions += 1; return false; }
      if (candidate.avoidedByReviewedSignal) { rejected.safety += 1; return false; }
      if (constraints.budgetLimitPence !== null && !priceEvidenceUsableForCeiling(candidate.price)) {
        rejected.budgetEvidence += 1;
        return false;
      }
      if (constraints.budgetLimitPence !== null && candidate.price.pence! > constraints.budgetLimitPence) {
        rejected.budgetCeiling += 1;
        return false;
      }
      const staticNeeds = constraints.accessibilityNeeds.filter((need) => need !== "low-noise");
      if (!staticNeeds.every((need) => accessNeedSatisfied(candidate.access, need, null))) {
        rejected.accessibility += 1;
        return false;
      }
      if (constraints.accessibilityNeeds.includes("low-noise")
        && (!constraints.routeWindow || !candidate.access.lowNoise)) {
        rejected.accessibility += 1;
        return false;
      }
      return true;
    });

  return constraints.routeWindow
    ? eligible.filter((candidate) => hasCurrentAttributableOpeningSchedule(candidate.openingSchedule, constraints.now))
    : eligible;
}

/** Select the strongest feasible three-stop route with deterministic tie-breaks. */
export function selectGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): GroundedPlanRouteSelection<T> {
  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
  if (constraints.transportConstraints.length > 0) {
    return { ok: false, eligibleCandidateCount: 0, rejected };
  }
  const routeEligible = routeEligibleCandidates(candidates, constraints, rejected);
  if (routeEligible.length < 3) {
    return { ok: false, eligibleCandidateCount: routeEligible.length, rejected };
  }

  const best = findBestRoute(routeEligible, constraints);
  if (!best) return { ok: false, eligibleCandidateCount: routeEligible.length, rejected };

  const stops = selectedStops(best);
  const selectedIds = new Set(best.route.map((candidate) => candidate.venueId));
  const alternatives = stops.map((_, position) => routeEligible.flatMap((candidate) => {
    if (selectedIds.has(candidate.venueId)) return [];
    const replacement = [...best!.route] as [
      GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>,
    ];
    replacement[position] = candidate;
    const evaluated = evaluateRoute(replacement, constraints);
    return evaluated ? [selectedStops(evaluated)[position]] : [];
  }).sort((left, right) => right.score - left.score
    || left.venueId.localeCompare(right.venueId, "en-GB"))) as [
      SelectedGroundedPlanStop<T>[], SelectedGroundedPlanStop<T>[], SelectedGroundedPlanStop<T>[],
    ];
  return { ok: true, stops, alternatives, timing: best.timing, constraintReport: report(best, constraints) };
}

export type AnchoredGroundedPlanRouteSelection<T> =
  | {
      ok: true;
      outcome: "route";
      stops: readonly [SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>];
      alternatives: readonly [
        readonly SelectedGroundedPlanStop<T>[],
        readonly SelectedGroundedPlanStop<T>[],
        readonly SelectedGroundedPlanStop<T>[],
      ];
      timing: PlanRouteTiming;
      constraintReport: PlanConstraintReport;
    }
  | {
      ok: true;
      outcome: "anchor-only";
      anchor: SelectedGroundedPlanStop<T>;
      reason: "ANCHOR_COMPANIONS_INSUFFICIENT";
    }
  | { ok: false; reason: "ANCHOR_MISSING" };

/** Build the anchor as a standalone grounded Stop 1 (no visit window, no swap). */
function anchorOnlyStop<T>(
  anchor: GroundedPlanRouteCandidate<T>,
  now: number,
): SelectedGroundedPlanStop<T> {
  const opening = assessOpeningSchedule(anchor.openingSchedule, null, now);
  return { ...anchor, position: 0, visitWindow: null, opening, constraintFlags: flagsFor(opening, false) };
}

/**
 * Select the strongest feasible route that keeps the accepted anchor as Stop 1.
 * Only permutations with the anchor at index zero are evaluated, the anchor has
 * no ordinary alternative, and when fewer than two companions can complete a
 * grounded route the accepted Venue is still returned as a one-Stop draft.
 */
export function selectAnchoredGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
  anchorVenueId: string,
): AnchoredGroundedPlanRouteSelection<T> {
  // The accepted Venue must be among the loaded candidates to carry evidence.
  const anchor = candidates.find((candidate) => candidate.venueId === anchorVenueId);
  if (!anchor) return { ok: false, reason: "ANCHOR_MISSING" };

  const anchorStop = anchorOnlyStop(anchor, constraints.now);
  const insufficient: AnchoredGroundedPlanRouteSelection<T> = {
    ok: true,
    outcome: "anchor-only",
    anchor: anchorStop,
    reason: "ANCHOR_COMPANIONS_INSUFFICIENT",
  };
  // Transport constraints are not modelled for routing; keep the anchor useful.
  if (constraints.transportConstraints.length > 0) return insufficient;

  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
  const companions = routeEligibleCandidates(candidates, constraints, rejected)
    .filter((candidate) => candidate.venueId !== anchorVenueId);

  let best: EvaluatedRoute<T> | null = null;
  for (let i = 0; i < companions.length; i += 1) {
    for (let j = 0; j < companions.length; j += 1) {
      if (i === j) continue;
      const evaluated = evaluateRoute([anchor, companions[i], companions[j]], constraints);
      if (evaluated && better(evaluated, best)) best = evaluated;
    }
  }
  if (!best) return insufficient;

  const stops = selectedStops(best);
  const selectedIds = new Set(best.route.map((candidate) => candidate.venueId));
  const alternatives = stops.map((_, position) => position === 0
    // The anchor owns Stop 1 and offers no ordinary alternative or Swap.
    ? []
    : companions.flatMap((candidate) => {
        if (selectedIds.has(candidate.venueId)) return [];
        const replacement = [...best!.route] as [
          GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>,
        ];
        replacement[position] = candidate;
        const evaluated = evaluateRoute(replacement, constraints);
        return evaluated ? [selectedStops(evaluated)[position]] : [];
      }).sort((left, right) => right.score - left.score
        || left.venueId.localeCompare(right.venueId, "en-GB"))) as [
          SelectedGroundedPlanStop<T>[], SelectedGroundedPlanStop<T>[], SelectedGroundedPlanStop<T>[],
        ];
  return { ok: true, outcome: "route", stops, alternatives, timing: best.timing, constraintReport: report(best, constraints) };
}
