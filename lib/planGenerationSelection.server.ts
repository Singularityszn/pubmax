import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { NightSignalClaim } from "@/lib/nightSignalClaims";
import { canAffectRoute } from "@/lib/nightSignalClaims";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanAccessibilityNeed } from "@/lib/planIntake";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import {
  planAccessEvidenceForVenue,
  planOpeningSchedulesForVenues,
  planPriceEvidenceForVenues,
} from "@/lib/planRouteEvidence.server";
import {
  selectGroundedPlanRoute,
  type GroundedPlanRouteSelection,
} from "@/lib/planRouteOptimizer";

export type ScoredPlanCandidate = {
  venue: ConciergeVenue;
  score: number;
  signalClaims: NightSignalClaim[];
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
    };

/** Join canonical evidence and run the intake-only hard-constraint optimizer. */
export async function selectPlanGenerationCandidates<T extends ScoredPlanCandidate>(
  candidates: readonly T[],
  context: NightContext,
  intake: ParsedPlanGenerationIntake | null,
  now: number,
): Promise<PlanGenerationSelection<T>> {
  if (!intake) return { ok: true, legacy: true, chosen: candidates.slice(0, 3) };
  const requiredAccessibilityNeeds: PlanAccessibilityNeed[] = [...intake.handoff.accessibilityNeeds];
  const venues = candidates.map(({ venue }) => venue);
  const [priceEvidence, openingSchedules] = await Promise.all([
    planPriceEvidenceForVenues(venues, now),
    planOpeningSchedulesForVenues(venues),
  ]);
  const selection = selectGroundedPlanRoute(
    candidates.map((candidate) => ({
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
    })),
    {
      exactArea: intake.exactNightArea,
      accessibilityNeeds: requiredAccessibilityNeeds,
      budgetLimitPence: context.budgetLimitPence,
      budgetTier: context.budget,
      groupSize: context.groupSize,
      transportConstraints: context.transportConstraints,
      routeWindow: intake.routeWindow,
      now,
    },
  );
  return selection.ok
    ? {
        ok: true,
        legacy: false,
        chosen: selection.stops.map((stop) => stop.value),
        selection,
        accessibilityEnforced: requiredAccessibilityNeeds.length > 0,
      }
    : { ok: false, selection };
}
