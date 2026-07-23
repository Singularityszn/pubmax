export type PlanConstraintDisclosure = {
  code: "safety" | "exclusions" | "exact_area" | "accessibility" | "budget_ceiling" | "opening_hours" | "transport_feasibility";
  status: "satisfied" | "flagged";
  message: string;
};

export type PlanConstraintReport = {
  version: 1;
  source: "plan-intake-v1";
  hardConstraints: PlanConstraintDisclosure[];
  softRelaxations: Array<{
    code: "group_fit_unverified" | "value_price_evidence_incomplete";
    message: string;
  }>;
};

export type PlanStopConstraintFlag = {
  code: "opening_hours_unconfirmed" | "recurring_hours_exception_warning";
  message: string;
};

export type GroundedRouteTimingSummary = {
  straightLineWalkingKm: number;
  walkingMinutes: number;
  transferUncertaintyMinutes: number;
  scheduledRouteMinutes: number;
};

export function planBudgetSummary(
  context: NightContext,
  prices: readonly (number | null)[],
): PlanBudgetSummary {
  const complete = prices.every((price): price is number => price !== null);
  const estimatedPerPersonPence = complete ? prices.reduce((total, price) => total + price, 0) : null;
  return {
    currency: "GBP",
    limitPence: context.budgetLimitPence,
    estimatedPerPersonPence,
    estimatedCrewPence: estimatedPerPersonPence === null
      ? null
      : estimatedPerPersonPence * Math.max(1, context.groupSize ?? 1),
    withinLimit: context.budgetLimitPence === null || estimatedPerPersonPence === null
      ? null
      : estimatedPerPersonPence <= context.budgetLimitPence,
    basis: "one-recorded-pint-per-stop",
  };
}

export function planRouteSummary(
  venues: readonly { lat: number; lng: number }[],
  grounded: GroundedRouteTimingSummary | null,
): PlanRouteTotals {
  let distance = grounded?.straightLineWalkingKm ?? 0;
  if (!grounded) for (let index = 0; index < venues.length - 1; index += 1) {
    distance += haversineKm([venues[index].lng, venues[index].lat], [venues[index + 1].lng, venues[index + 1].lat]);
  }
  return {
    stopCount: venues.length,
    straightLineWalkingKm: Number(distance.toFixed(2)),
    estimatedWalkingMinutes: grounded?.walkingMinutes ?? Math.ceil((distance / 4.8) * 60),
    distanceBasis: "straight-line",
  };
}

export function planRouteTimingDisclosure(grounded: GroundedRouteTimingSummary | null) {
  return grounded ? {
    walkingSpeedKmh: 4.8,
    walkingMinutes: grounded.walkingMinutes,
    transferUncertaintyMinutes: grounded.transferUncertaintyMinutes,
    scheduledRouteMinutes: grounded.scheduledRouteMinutes,
    basis: "straight-line walking estimate; add five minutes uncertainty per transfer",
  } : null;
}
import { haversineKm } from "@/lib/haversine";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanRouteTotals } from "@/lib/planIntelligence";
