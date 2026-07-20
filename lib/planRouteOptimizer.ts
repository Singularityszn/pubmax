import { haversineKm } from "@/lib/haversine";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import type { Budget, NightAreaSlug } from "@/lib/nightPlanning";
import type {
  PlanConstraintReport,
  PlanStopConstraintFlag,
} from "@/lib/planGenerationDto";
import {
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
  if (opening.some((assessment) => assessment.state === "listed_closed")) return null;
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
  const unknownOpening = evaluation.opening.some((item) => item.state === "unknown");
  return {
    version: 1,
    source: "plan-intake-v1",
    hardConstraints: [
      { code: "safety", status: "satisfied", message: "Stops with an active reviewed avoid signal were excluded." },
      { code: "exclusions", status: "satisfied", message: "Excluded and promoted venues were not eligible." },
      {
        code: "transport_feasibility",
        status: constraints.transportConstraints.length ? "flagged" : "satisfied",
        message: constraints.transportConstraints.length
          ? "The route passed direct-distance walking limits, but requested per-venue transport evidence is unavailable."
          : `Travel time uses ${PLAN_WALKING_KMH} km/h direct-distance walking plus ${PLAN_TRANSFER_UNCERTAINTY_MINUTES} minutes uncertainty per leg; pavement routing is not claimed.`,
      },
      ...(constraints.exactArea ? [{
        code: "exact_area" as const,
        status: "satisfied" as const,
        message: "Every stop is inside the mapped Night Area radius for the selected Night Patch.",
      }] : []),
      ...(constraints.accessibilityNeeds.length ? [{
        code: "accessibility" as const,
        status: "satisfied" as const,
        message: "Every stop has distinct applicable evidence for every required access need at its visit time.",
      }] : []),
      ...(constraints.budgetLimitPence !== null ? [{
        code: "budget_ceiling" as const,
        status: "satisfied" as const,
        message: "The attributable, non-stale recorded one-pint-per-stop total is within the per-person ceiling.",
      }] : []),
      ...(dated ? [{
        code: "opening_hours" as const,
        status: "flagged" as const,
        message: unknownOpening
          ? "No stop is listed closed, but at least one visit lacks fresh recurring-hours evidence."
          : "Recurring weekly schedules list every stop open; holiday and one-off exceptions are not confirmed and must be checked.",
      }] : []),
    ],
    softRelaxations: [
      ...((constraints.groupSize ?? 0) >= 6 ? [{
        code: "group_fit_unverified" as const,
        message: "The requested group size could not shape ranking because venue capacity is not evidenced in the dataset.",
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

/** Enumerate every ordered three-stop route, then apply deterministic tie-breaks. */
export function selectGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): GroundedPlanRouteSelection<T> {
  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
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

  let best: EvaluatedRoute<T> | null = null;
  for (let first = 0; first < eligible.length; first += 1) {
    for (let second = 0; second < eligible.length; second += 1) {
      if (second === first) continue;
      for (let third = 0; third < eligible.length; third += 1) {
        if (third === first || third === second) continue;
        const evaluated = evaluateRoute([eligible[first], eligible[second], eligible[third]], constraints);
        if (evaluated && better(evaluated, best)) best = evaluated;
      }
    }
  }
  if (!best) return { ok: false, eligibleCandidateCount: eligible.length, rejected };

  const stops = selectedStops(best);
  const selectedIds = new Set(best.route.map((candidate) => candidate.venueId));
  const alternatives = stops.map((_, position) => eligible.flatMap((candidate) => {
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
