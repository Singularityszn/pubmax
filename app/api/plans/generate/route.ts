import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage, type NightArea } from "@/lib/nightAreas";
import type { NightContext } from "@/lib/nightPlanning";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { haversineKm } from "@/lib/haversine";
import type { PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import { estimatePlanWalking, estimateStraightLinePlanWalking } from "@/lib/walkRouteLegs";
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
	planRouteTimingDisclosure,
} from "@/lib/planGenerationDto";
import { planEvidenceWarning, planGenerationEvidenceGaps, scoreVenueForPlan } from "@/lib/planGenerationRanking";
import { selectAnchoredPlanGenerationCandidates, selectPlanGenerationCandidates, type ScoredPlanCandidate } from "@/lib/planGenerationSelection.server";
import type { PlanGenerationAnchor } from "@/lib/planGenerationRequest";
import { planTemporalEvidence } from "@/lib/planGenerationTemporalEvidence";
import type { PlanConstraintReport, PlanRouteTiming, SelectedGroundedPlanStop } from "@/lib/planRouteOptimizer";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";
import type { PlanningIntentSource } from "@/lib/planningIntent";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";
import { mintPlanGroundingProof, mintPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
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

type AnchoredRouteData<T extends ScoredPlanCandidate> = {
	chosen: T[];
	groundedStops: readonly SelectedGroundedPlanStop<T>[];
	groundedAlternatives: readonly (readonly SelectedGroundedPlanStop<T>[])[];
	groundedTiming: PlanRouteTiming;
	constraintReport: PlanConstraintReport;
	accessibilityEnforced: boolean;
	anchorContext: { anchorVenueId: string; anchorSource: PlanningIntentSource };
};

/**
 * Preflight the accepted anchor and run the anchor-pinned optimizer. Returns a
 * ready Response for the conflict and one-Stop anchor-only outcomes, or the
 * grounded route data for the shared three-Stop response assembly.
 */
async function runAnchoredGeneration<T extends ScoredPlanCandidate>(params: {
	cityId: CityId;
	anchor: PlanGenerationAnchor;
	candidates: readonly T[];
	context: NightContext;
	intake: ParsedPlanGenerationIntake | null;
	requestNow: number;
	operationKey: string;
	area: NightArea;
	coverage: ReturnType<typeof publicNightAreaCoverage>;
}): Promise<{ done: Response } | { route: AnchoredRouteData<T> }> {
	const { cityId, anchor, candidates, context, intake, requestNow, operationKey, area, coverage } = params;
	const nightArea = { id: area.slug, ...coverage };
	const anchorConflict = (reason: string, message: string): { done: Response } => ({
		done: jsonNoStore({
			grounded: false,
			outcome: "anchor-conflict",
			anchored: true,
			routeReady: false,
			stops: [],
			reason,
			message,
			operationKey,
			nightArea,
		}, { status: 200 }),
	});

	const anchorResolution = await resolvePlanningAnchor({
		cityId,
		venueId: anchor.venueId,
		startsAt: anchor.startsAt,
		acceptedArea: anchor.acceptedArea,
		now: requestNow,
	});
	if (anchorResolution.status === "conflict") {
		return anchorConflict(anchorResolution.code, anchorResolution.message);
	}
	const anchorVenueId = anchorResolution.canonical.venueId;
	const selection = await selectAnchoredPlanGenerationCandidates(candidates, context, intake, requestNow, anchorVenueId);
	if (!selection.ok) {
		return anchorConflict("ANCHOR_ROUTE_CONFLICT", "We could not build a Route from that Venue right now. Try a different anchor.");
	}
	if (selection.outcome === "anchor-only") {
		let anchorOnlyProof: string;
		try {
			anchorOnlyProof = mintPlanGroundingProofV2({
				routeVenueIds: [anchorVenueId],
				allowedVenueIds: [anchorVenueId],
				anchorVenueId,
				anchorSource: anchor.source,
				outcome: "anchor-only",
				operationKey,
			}, requestNow);
		} catch (error) {
			const unavailable = planSigningUnavailableResponse(error);
			if (unavailable) return { done: unavailable };
			throw error;
		}
		const stop = selection.anchor;
		return { done: jsonNoStore({
			// A grounded one-Stop draft: the accepted Venue is kept as Stop 1 and
			// never emits plan_accepted (routeReady stays false until three Stops).
			grounded: true,
			outcome: "anchor-only",
			anchored: true,
			routeReady: false,
			reason: "ANCHOR_COMPANIONS_INSUFFICIENT",
			anchorVenueId,
			anchorSource: anchor.source,
			groundingProof: anchorOnlyProof,
			operationKey,
			inferredContext: context,
			nightArea,
			stops: [{
				venueId: stop.venueId,
				venueName: stop.venueName,
				position: 0,
				estimatedPintPricePence: stop.price.pence,
				priceEvidence: stop.price,
				accessEvidence: stop.access,
				constraintFlags: stop.constraintFlags,
				operationalEvidence: {
					openingAtVisit: stop.opening.state,
					openingSource: stop.opening.source,
					visitWindow: null,
					transportBasis: "compact-straight-line",
				},
				provenance: [
					{ kind: "venue_dataset", label: `PUBMAXX venue record for ${stop.venueName}` },
					{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
				],
				alternatives: [],
			}],
		}, { status: 200 }) };
	}
	return { route: {
		chosen: selection.chosen,
		groundedStops: selection.selection.stops,
		groundedAlternatives: selection.selection.alternatives,
		groundedTiming: selection.selection.timing,
		constraintReport: selection.selection.constraintReport,
		accessibilityEnforced: selection.accessibilityEnforced,
		anchorContext: { anchorVenueId, anchorSource: anchor.source },
	} };
}

export async function POST(request: Request): Promise<Response> {
	const requestNow = Date.now();
	const parsedRequest = await parsePlanGenerationRequest(request, new Date(requestNow));
	if (!parsedRequest.ok) {
		return publicApiError(parsedRequest.message, parsedRequest.code, parsedRequest.status);
	}
	const { query, context: contextPatch, intake } = parsedRequest.value;
  // Do not spend a caller's limiter budget when this process cannot mint the
  // trusted proof required for any successful generation response.
  const signingUnavailable = planSigningPreflightResponse();
  if (signingUnavailable) return signingUnavailable;
  const operationKey = parsedRequest.value.operationKey ?? `create-${randomUUID()}`;
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
	let anchorContext: { anchorVenueId: string; anchorSource: PlanningIntentSource } | null = null;
	let chosen: Candidate[];
	const anchorRequest = parsedRequest.value.anchor;
	// Anchored generation is opt-in behind the flag; off ignores the anchor and
	// leaves the legacy unanchored path byte-identical.
	if (readTrustedHandoffFlag("anchoredGeneration") && anchorRequest) {
		const anchored = await runAnchoredGeneration({
			cityId, anchor: anchorRequest, candidates, context, intake, requestNow, operationKey, area, coverage,
		});
		if ("done" in anchored) return anchored.done;
		chosen = anchored.route.chosen;
		groundedStops = anchored.route.groundedStops;
		groundedAlternatives = anchored.route.groundedAlternatives;
		groundedTiming = anchored.route.groundedTiming;
		constraintReport = anchored.route.constraintReport;
		accessibilityEnforced = anchored.route.accessibilityEnforced;
		anchorContext = anchored.route.anchorContext;
	} else {
		const generatedSelection = await selectPlanGenerationCandidates(candidates, context, intake, requestNow);
		if (!generatedSelection.ok) {
			return publicApiError(
				`No three-stop route in ${area.name} can satisfy every required constraint with the evidence available.`,
				"GROUNDED_CONSTRAINTS_UNSATISFIED",
				422,
				{ details: { nightArea: area.slug, availableVenueCount: candidates.length, ...generatedSelection.selection } },
			);
		}
		chosen = generatedSelection.chosen;
		if (!generatedSelection.legacy) {
			groundedStops = generatedSelection.selection.stops;
			groundedAlternatives = generatedSelection.selection.alternatives;
			groundedTiming = generatedSelection.selection.timing;
			constraintReport = generatedSelection.selection.constraintReport;
			accessibilityEnforced = generatedSelection.accessibilityEnforced;
		}
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
	// Per-stop walking minutes (Sol S3). Fail-soft: keyless keeps the straight-
	// line estimate; a routing failure never blocks generation. When the ORS key
	// is present AND the global daily budget allows the call (lib/walkRouteLegs
	// routes every provider call through consumeOrsBudget), routed leg durations
	// upgrade the totals to a "routed" basis.
	const chosenWalkingStops = chosen.map(({ venue }) => ({ lat: venue.lat, lng: venue.lng }));
	const walkingEstimate = await estimatePlanWalking(chosenWalkingStops).catch(() =>
		estimateStraightLinePlanWalking(chosenWalkingStops),
	);
	const routeTotals: PlanRouteTotals = {
		stopCount: chosen.length,
		straightLineWalkingKm: Number(walkingEstimate.straightLineWalkingKm.toFixed(2)),
		estimatedWalkingMinutes: walkingEstimate.estimatedWalkingMinutes,
		distanceBasis: walkingEstimate.distanceBasis,
	};
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
	const stops = chosen.map(({ venue, distance, reasons, tonightEvents, signalClaims }, index) => {
		const grounded = groundedStops?.[index] ?? null;
		const alternativeCandidates = groundedAlternatives?.[index]
			?? candidates.filter(({ venue: alternative }) =>
				!chosen.some(({ venue: selected }) => selected.id === alternative.id));
		// The leg feeding THIS stop (from the previous stop). Routed only when
		// estimatePlanWalking secured an ORS duration for it; drives both the
		// per-stop minutes and an honest transportBasis label below.
		const legRouted = walkingEstimate.legs.some((leg) => leg.toIndex === index && leg.source === "ors");
		return {
			venueId: venue.id,
			venueName: venue.name,
			position: index,
			walkingMinutesFromPrevious: walkingEstimate.walkingMinutesFromPrevious[index] ?? null,
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
				transportBasis: legRouted
					? "openrouteservice foot-walking route duration"
					: grounded
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
	});
	// Ground the proof over exactly the venues this response commits to: the
	// three chosen stops plus every alternative id we actually emit above.
	const groundingCandidateIds = [
		...chosen.map(({ venue }) => venue.id),
		...stops.flatMap((stop) => stop.alternatives.map((alternative) => alternative.venueId)),
	];
	let groundingProof: string;
	try {
		groundingProof = anchorContext
			? mintPlanGroundingProofV2({
				// chosen[0] is the anchor: exact server-selected order, anchor first.
				routeVenueIds: chosen.map(({ venue }) => venue.id),
				allowedVenueIds: groundingCandidateIds,
				anchorVenueId: anchorContext.anchorVenueId,
				anchorSource: anchorContext.anchorSource,
				outcome: "route",
				operationKey,
			}, requestNow)
			: mintPlanGroundingProof(groundingCandidateIds, operationKey, requestNow);
	} catch (error) {
		const unavailable = planSigningUnavailableResponse(error);
		if (unavailable) return unavailable;
		throw error;
	}
  return jsonNoStore({
    // This response is assembled exclusively from the reviewed venue dataset
    // above and only exists when three canonical venue records were selected.
    // The explicit flag lets clients distinguish server-grounded generation
    // from a manual draft without guessing from unrelated revision metadata.
    grounded: true,
    ...(anchorContext ? {
      outcome: "route" as const,
      anchored: true,
      routeReady: true,
      anchorVenueId: anchorContext.anchorVenueId,
      anchorSource: anchorContext.anchorSource,
    } : {}),
    groundingProof,
    operationKey,
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
		stops,
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
