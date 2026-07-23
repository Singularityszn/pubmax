import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import type { PlanningConfidence } from "@/lib/planIntelligence";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import {
	canAffectRoute,
	claimsForEntity,
} from "@/lib/nightSignalClaims";
import { isLimited } from "@/lib/pintDrops";
import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { planGenerationEndings } from "@/lib/planGenerationEndings.server";
import {
	planBudgetSummary,
	planRouteSummary,
	planRouteTimingDisclosure,
} from "@/lib/planGenerationDto";
import { planEvidenceWarning, planGenerationEvidenceGaps, scoreVenueForPlan } from "@/lib/planGenerationRanking";
import { selectPlanGenerationCandidates } from "@/lib/planGenerationSelection.server";
import { planTemporalEvidence } from "@/lib/planGenerationTemporalEvidence";
import type { PlanConstraintReport, SelectedGroundedPlanStop } from "@/lib/planRouteOptimizer";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/supabase";
import weatherSnapshot from "@/public/data/weather/latest.json";

assertServerEnv();

let baselineWhatsOn: WhatsOnRow[] | null = null;

function baselineWhatsOnRows(): WhatsOnRow[] {
  baselineWhatsOn ??= loadBaselineWhatsOn();
  return baselineWhatsOn;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	return haversineKm([a.lng, a.lat], [b.lng, b.lat]);
}

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * never creates a plan, records a location, or consumes a generation budget.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cityId = parseCityId(url.searchParams.get("cityId") ?? "") ?? DEFAULT_CITY_ID;
  await loadConciergeVenues(cityId);
  baselineWhatsOnRows();
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
	const requestNow = Date.now();
	const parsedRequest = await parsePlanGenerationRequest(request, new Date(requestNow));
	if (!parsedRequest.ok) {
		return publicApiError(parsedRequest.message, parsedRequest.code, parsedRequest.status);
	}
	const { query, context: contextPatch, intake } = parsedRequest.value;
  const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) return publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true });
	if (intake?.unsupportedPatch) {
		return publicApiError(
			"Exact Plan generation is not available for this genuinely unmapped Night Patch yet.",
			"NIGHT_PATCH_UNSUPPORTED",
			422,
			{ details: { patchId: intake.unsupportedPatch } },
		);
	}
	if (!query && !contextPatch && !intake?.exactNightArea) return publicApiError("Describe the night or provide Night Context.", "NIGHT_CONTEXT_REQUIRED", 400);
	const reconciled = reconcilePlanContext(query, contextPatch, intake, new Date(requestNow));
	const context = reconciled.context;
  if (!context.nightArea) return publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422);
	const cityId = parsedRequest.value.cityId ? parseCityId(parsedRequest.value.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("cityId is invalid.", "CITY_INVALID", 400);
  const area = getNightArea(context.nightArea);
  if (area.cityId !== cityId) return publicApiError("That area isn't in this city.", "NIGHT_AREA_CITY_MISMATCH", 422);
	const routeReady = isNightAreaRouteReady(area, new Date(requestNow));
	const coverage = publicNightAreaCoverage(area);
	const temporalEvidence = planTemporalEvidence({
		weatherSnapshot,
		nightSignalSnapshot,
		whatsOnRows: baselineWhatsOnRows(),
		nightArea: area.slug,
		requestNow,
		routeWindow: intake?.routeWindow,
	});
	const planningWeather = temporalEvidence.weather;
	const tonightRows = temporalEvidence.whatsOn;
	const reviewedSignalClaims = temporalEvidence.signalClaims;
	if (
		claimsForEntity(reviewedSignalClaims, "night_area", area.slug)
			.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid")
	) {
		return publicApiError(
			"A reviewed active exclusion means this Night Area cannot be routed right now.",
			"NIGHT_AREA_CONSTRAINT_BLOCKED",
			422,
			{ details: { nightArea: area.slug } },
		);
	}
	const tonightByVenue = new Map<string, WhatsOnRow[]>();
	for (const row of tonightRows) {
		if (!row.venueId) continue;
		const current = tonightByVenue.get(row.venueId) ?? [];
		current.push(row);
		tonightByVenue.set(row.venueId, current);
	}
	  const candidates = (await loadConciergeVenues(cityId))
	    .map((venue) => {
	      const distance = distanceKm(area.centre, venue);
	      const tonightEvents = tonightByVenue.get(venue.id) ?? [];
	      const signalClaims = claimsForEntity(reviewedSignalClaims, "venue", venue.id);
	      const scored = scoreVenueForPlan(venue, context, distance, tonightEvents, signalClaims, planningWeather);
	      return { venue, distance, tonightEvents, signalClaims, ...scored };
	    })
    .filter(({ distance, venue, signalClaims }) =>
		distance <= area.radiusKm
		&& venue.promoted !== true
		&& !signalClaims.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid"))
    .sort((a, b) => b.score - a.score);
	type Candidate = (typeof candidates)[number];
	let groundedStops: readonly SelectedGroundedPlanStop<Candidate>[] | null = null;
	let groundedAlternatives: readonly (readonly SelectedGroundedPlanStop<Candidate>[])[] | null = null;
	let constraintReport: PlanConstraintReport | null = null;
	let groundedTiming: { straightLineWalkingKm: number; walkingMinutes: number; transferUncertaintyMinutes: number; scheduledRouteMinutes: number } | null = null;
	let accessibilityEnforced = false;
	const generatedSelection = await selectPlanGenerationCandidates(candidates, context, intake, requestNow);
	if (!generatedSelection.ok) {
		return publicApiError(
			`No three-stop route in ${area.name} can satisfy every required constraint with the evidence available.`,
			"GROUNDED_CONSTRAINTS_UNSATISFIED",
			422,
			{ details: { nightArea: area.slug, availableVenueCount: candidates.length, ...generatedSelection.selection } },
		);
	}
	const chosen = generatedSelection.chosen;
	if (!generatedSelection.legacy) {
		groundedStops = generatedSelection.selection.stops;
		groundedAlternatives = generatedSelection.selection.alternatives;
		groundedTiming = generatedSelection.selection.timing;
		constraintReport = generatedSelection.selection.constraintReport;
		accessibilityEnforced = generatedSelection.accessibilityEnforced;
	}
  if (chosen.length < 3) return publicApiError(`Not enough grounded venues are available in ${area.name} yet.`, "GROUNDED_VENUES_INSUFFICIENT", 422, { details: { nightArea: area.slug, availableVenueCount: chosen.length } });
	const pricePence = chosen.map(({ venue }, position) => groundedStops
		? groundedStops[position].price.pence
		: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100));
	const hasCompletePriceEvidence = pricePence.every((price): price is number => price !== null);
	const { contextEvidenceGaps, operationalEvidenceGaps } = planGenerationEvidenceGaps({
		context,
		accessibilityEnforced,
		hasDatedWindow: Boolean(intake?.routeWindow),
		allOpeningListed: Boolean(groundedStops?.every((stop) => stop.opening.state === "listed_open")),
		hasCompletePriceEvidence,
		allZeroProofConfirmed: chosen.every(({ venue }) => venue.amenities.nonAlcoholic === true),
		hasTonightEvidence: chosen.some(({ tonightEvents }) => tonightEvents.length > 0),
		hasWeatherEvidence: Boolean(planningWeather),
	});
	const missingEvidence = [...new Set([...area.missingEvidence, ...contextEvidenceGaps, ...operationalEvidenceGaps])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(reconciled.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (missingEvidence.length ? "medium" : "high") : "low",
		score: Number(confidenceScore.toFixed(2)),
		routeReady,
		missingEvidence,
		warnings: missingEvidence.map(planEvidenceWarning),
		provenance: [
			{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
			{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
			...(planningWeather ? [{
				kind: "night_signal" as const,
				label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
				asOf: planningWeather.observedAt,
			}] : []),
		],
	};
	const budgetSummary = planBudgetSummary(context, pricePence);
	const routeTotals = planRouteSummary(chosen.map(({ venue }) => venue), groundedTiming);
	const endingRecommendations = planGenerationEndings({
		chosen,
		candidates,
		groundedAlternatives,
		hasIntake: Boolean(intake),
		context,
		areaSlug: area.slug,
		transportAnchor: area.transportAnchors[0] ?? area.name,
		now: requestNow,
	});
	const nightArea = { id: area.slug, ...coverage };
  return jsonNoStore({
    inferredContext: context,
		contextFieldSources: reconciled.fieldSources,
    confidence: reconciled.confidence,
		planningConfidence,
		budgetSummary,
		routeTotals,
		routeTiming: planRouteTimingDisclosure(groundedTiming),
		endingRecommendations,
		weatherEvidence: planningWeather,
		nightArea,
		...(constraintReport ? { constraintReport } : {}),
		// Back-compatible alias until every client has moved to Night Area.
		district: nightArea,
		explanations: reconciled.reasons,
	    stops: chosen.map(({ venue, distance, reasons, tonightEvents, signalClaims }, index) => {
			const grounded = groundedStops?.[index] ?? null;
			const alternativeCandidates = groundedAlternatives?.[index]
				?? candidates.filter(({ venue: alternative }) =>
					!chosen.some(({ venue: selected }) => selected.id === alternative.id));
			return {
				venueId: venue.id,
				venueName: venue.name,
				position: index,
			distanceKm: Number(distance.toFixed(2)),
			estimatedPintPricePence: grounded
				? grounded.price.pence
				: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
			priceEvidence: grounded?.price ?? null,
			accessEvidence: grounded?.access ?? null,
			evidence: reasons,
			constraintFlags: grounded?.constraintFlags ?? [],
			operationalEvidence: {
				openingAtVisit: grounded?.opening.state ?? null,
				openingSource: grounded?.opening.source ?? null,
				visitWindow: grounded?.visitWindow ?? null,
				transportBasis: grounded
					? "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg"
					: "compact-straight-line",
			},
			provenance: [
				{ kind: "venue_dataset", label: `PUBMAXX venue record for ${venue.name}` },
				{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
				...tonightEvents.map((event) => ({ kind: "night_signal" as const, label: `${event.source.label}: ${event.title}`, asOf: event.observedAt })),
				...signalClaims.map((signal) => ({ kind: "night_signal" as const, label: `${signal.publisher}: ${signal.claim}`, asOf: signal.observedAt })),
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
				alternatives: alternativeCandidates
				.map((alternativeEntry) => {
					const alternativeGrounded = "value" in alternativeEntry ? alternativeEntry : null;
					const alternative = alternativeGrounded
						? alternativeGrounded.value.venue
						: (alternativeEntry as Candidate).venue;
					return {
						venueId: alternative.id,
						venueName: alternative.name,
						distanceKm: Number(distanceKm(venue, alternative).toFixed(2)),
						estimatedPintPricePence: alternativeGrounded
							? alternativeGrounded.price.pence
							: alternative.cheapestPrice === null ? null : Math.round(alternative.cheapestPrice * 100),
						priceEvidence: alternativeGrounded?.price ?? null,
						accessEvidence: alternativeGrounded?.access ?? null,
						constraintFlags: alternativeGrounded?.constraintFlags ?? [],
						operationalEvidence: {
							openingAtVisit: alternativeGrounded?.opening.state ?? null,
							openingSource: alternativeGrounded?.opening.source ?? null,
							visitWindow: alternativeGrounded?.visitWindow ?? null,
							transportBasis: alternativeGrounded
								? "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg"
								: "compact-straight-line",
						},
						provenance: [{ kind: "venue_dataset", label: `PUBMAXX venue record for ${alternative.name}` }],
					};
				})
				.sort((left, right) => left.distanceKm - right.distanceKm)
				.slice(0, 2),
			};
		}),
	    contextEffects: [
	      "budget",
	      "daypart",
	      ...(context.groupSize ? ["groupSize"] : []),
	      ...(context.partyType !== "friends" ? ["partyType"] : []),
	      ...(context.atmosphere.length ? ["atmosphere"] : []),
	      ...(context.foodNeeds.length ? ["foodNeeds"] : []),
			...(context.budgetLimitPence ? ["budgetLimitPence"] : []),
			...(context.zeroProof ? ["zeroProof"] : []),
			...(planningWeather ? ["weather"] : []),
	    ],
	    missingContextEvidence: contextEvidenceGaps,
	    relevantSignals: area.recentSignals,
		nightSignalClaims: reviewedSignalClaims.filter((claim) =>
			(claim.entity.type === "night_area" && claim.entity.id === area.slug) ||
			chosen.some(({ venue }) => claim.entity.type === "venue" && claim.entity.id === venue.id),
		),
	  });
}
