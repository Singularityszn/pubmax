import { selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
type PlanConstraintDisclosure = {
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

type PlanGenerationDtoVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
};

type PlanGenerationDtoCandidate = {
  venue: PlanGenerationDtoVenue;
  selectedDrinkPrice?: MapLensPrice | null;
  distance: number;
  reasons: readonly string[];
  tonightEvents: readonly {
    title: string;
    observedAt: string;
    source: { label: string };
  }[];
  signalClaims: readonly {
    publisher: string;
    claim: string;
    observedAt: string;
  }[];
};

type PlanGenerationDtoGroundedStop = {
  value: PlanGenerationDtoCandidate;
  price: PlanPriceEvidence;
  access: PlanAccessEvidence;
  opening: OpeningAssessment;
  visitWindow: { startsAt: string; endsAt: string } | null;
  constraintFlags: readonly PlanStopConstraintFlag[];
};

type PlanGenerationDtoWalking = {
  legs: readonly { toIndex: number; source: string }[];
  walkingMinutesFromPrevious: readonly (number | null)[];
};

type PlanGenerationDtoWeather = {
  condition: string;
  observedAt: string;
  source: { publisher: string };
};

function venueDistanceKm(left: PlanGenerationDtoVenue, right: PlanGenerationDtoVenue): number {
  return haversineKm([left.lng, left.lat], [right.lng, right.lat]);
}

/**
 * Pint evidence prices only a beer (or unspecified) night. An alcohol-free or
 * other selected-drink night never borrows it: a pint price is not the price of
 * what that crew will drink, so a stated per-person ceiling on such a night
 * fails closed (422, budgetEvidence) rather than passing on alcoholic prices.
 */
export function planUsesPintPrices(context: Pick<NightContext, "drinkCategory" | "zeroProof">): boolean {
  return !context.zeroProof && (!context.drinkCategory || context.drinkCategory === "beer");
}

function planAlternativeDto(
  origin: PlanGenerationDtoVenue,
  candidate: PlanGenerationDtoCandidate,
  grounded: PlanGenerationDtoGroundedStop | null,
  priceContext: Pick<NightContext, "drinkCategory" | "zeroProof">,
) {
  const alternative = candidate.venue;
  const usesPintPrices = planUsesPintPrices(priceContext);
  return {
    venueId: alternative.id,
    venueName: alternative.name,
    distanceKm: Number(venueDistanceKm(origin, alternative).toFixed(2)),
    estimatedPintPricePence: !usesPintPrices ? null : grounded
      ? grounded.price.pence
      : alternative.cheapestPrice === null
        ? null
        : Math.round(alternative.cheapestPrice * 100),
    priceEvidence: usesPintPrices ? grounded?.price ?? null : null,
    selectedDrinkPriceEvidence: selectedDrinkPriceEvidenceForPrice(candidate.selectedDrinkPrice, priceContext),
    accessEvidence: grounded?.access ?? null,
    constraintFlags: grounded?.constraintFlags ?? [],
    operationalEvidence: {
      openingAtVisit: grounded?.opening.state ?? null,
      openingSource: grounded?.opening.source ?? null,
      visitWindow: grounded?.visitWindow ?? null,
      transportBasis: grounded
        ? `direct-distance at ${WALK_KMH} km/h plus 5 minutes uncertainty per leg`
        : "compact-straight-line",
    },
    provenance: [{
      kind: "venue_dataset",
      label: `PUBMAXX venue record for ${alternative.name}`,
    }],
  };
}

/** Pure projection from selected candidates and evidence to public Stop DTOs. */
export function buildPlanGenerationStops(params: {
  chosen: readonly PlanGenerationDtoCandidate[];
  candidates: readonly PlanGenerationDtoCandidate[];
  groundedStops: readonly PlanGenerationDtoGroundedStop[] | null;
  groundedAlternatives: readonly (readonly PlanGenerationDtoGroundedStop[])[] | null;
  walkingEstimate: PlanGenerationDtoWalking;
  area: { name: string; lastReviewedAt: string | null };
  planningWeather: PlanGenerationDtoWeather | null;
  priceContext: Pick<NightContext, "drinkCategory" | "zeroProof">;
}) {
  const {
    chosen,
    candidates,
    groundedStops,
    groundedAlternatives,
    walkingEstimate,
    area,
    planningWeather,
    priceContext,
  } = params;
  const usesPintPrices = planUsesPintPrices(priceContext);
  const chosenVenueIds = new Set(chosen.map(({ venue }) => venue.id));

  return chosen.map(({ venue, distance, reasons, tonightEvents, signalClaims }, index) => {
    const grounded = groundedStops?.[index] ?? null;
    const groundedAlternativeCandidates = groundedAlternatives?.[index] ?? null;
    const alternatives = groundedAlternativeCandidates
      ? groundedAlternativeCandidates.map((entry) =>
          planAlternativeDto(venue, entry.value, entry, priceContext))
      : candidates
          .filter(({ venue: alternative }) => !chosenVenueIds.has(alternative.id))
          .map((entry) => planAlternativeDto(venue, entry, null, priceContext));
    const legRouted = walkingEstimate.legs.some(
      (leg) => leg.toIndex === index && leg.source === "ors",
    );

    return {
      venueId: venue.id,
      venueName: venue.name,
      position: index,
      walkingMinutesFromPrevious: walkingEstimate.walkingMinutesFromPrevious[index] ?? null,
      distanceKm: Number(distance.toFixed(2)),
      estimatedPintPricePence: !usesPintPrices ? null : grounded
        ? grounded.price.pence
        : venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
      priceEvidence: usesPintPrices ? grounded?.price ?? null : null,
      selectedDrinkPriceEvidence: selectedDrinkPriceEvidenceForPrice(chosen[index]?.selectedDrinkPrice, priceContext),
      accessEvidence: grounded?.access ?? null,
      evidence: reasons,
      constraintFlags: grounded?.constraintFlags ?? [],
      operationalEvidence: {
        openingAtVisit: grounded?.opening.state ?? null,
        openingSource: grounded?.opening.source ?? null,
        visitWindow: grounded?.visitWindow ?? null,
        transportBasis: legRouted
          ? ROUTED_WALK_TRANSPORT_BASIS
          : grounded
            ? `direct-distance at ${WALK_KMH} km/h plus 5 minutes uncertainty per leg`
            : "compact-straight-line",
      },
      provenance: [
        { kind: "venue_dataset", label: `PUBMAXX venue record for ${venue.name}` },
        { kind: "night_area_review", label: `${area.name} route review`, asOf: area.lastReviewedAt },
        ...tonightEvents.map((event) => ({
          kind: "night_signal" as const,
          label: `${event.source.label}: ${event.title}`,
          asOf: event.observedAt,
        })),
        ...signalClaims.map((signal) => ({
          kind: "night_signal" as const,
          label: `${signal.publisher}: ${signal.claim}`,
          asOf: signal.observedAt,
        })),
        ...(grounded?.opening.source ? [{
          kind: "night_signal" as const,
          label: grounded.opening.source.label,
          asOf: grounded.opening.source.observedAt,
        }] : []),
        ...(planningWeather ? [{
          kind: "night_signal" as const,
          label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
          asOf: planningWeather.observedAt,
        }] : []),
      ],
      reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${reasons.length ? `, ${reasons.slice(0, 2).join(", ")}` : ""}.`,
      alternatives: alternatives
        .sort((left, right) => left.distanceKm - right.distanceKm)
        .slice(0, 2),
    };
  });
}

export function planBudgetSummary(
  context: NightContext,
  prices: readonly (number | null)[],
): PlanBudgetSummary {
  const usesPintPrices = planUsesPintPrices(context);
  const complete = usesPintPrices && prices.every((price): price is number => price !== null);
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
    basis: usesPintPrices ? "one-recorded-pint-per-stop" : "selected-drink-price-unavailable",
  };
}

export function planRouteTimingDisclosure(grounded: GroundedRouteTimingSummary | null) {
  return grounded ? {
    walkingSpeedKmh: WALK_KMH,
    walkingMinutes: grounded.walkingMinutes,
    transferUncertaintyMinutes: grounded.transferUncertaintyMinutes,
    scheduledRouteMinutes: grounded.scheduledRouteMinutes,
    basis: "straight-line walking estimate; add five minutes uncertainty per transfer",
  } : null;
}
import { haversineKm } from "@/lib/haversine";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary } from "@/lib/planIntelligence";
import type {
  OpeningAssessment,
  PlanAccessEvidence,
  PlanPriceEvidence,
} from "@/lib/planRouteEvidence";
import { ROUTED_WALK_TRANSPORT_BASIS, WALK_KMH } from "@/lib/routeLegs";
