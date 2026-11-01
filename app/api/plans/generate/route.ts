import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { cultureOutingCosts, type CultureOpenerDTO } from "@/lib/cultureCrawl";
import { planCultureOpenerFields } from "@/lib/cultureCrawl.server";
import { dryRoundWire, type DryRoundAlcoholFree, type DryRoundWire } from "@/lib/dryRound";
import type { PlanBudgetSummary, PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import { estimatePlanWalking, estimateStraightLinePlanWalking } from "@/lib/walkRouteLegs";
import { pubStreetWalkKm } from "@/lib/pubWalkPairs.server";
import { planGenerationEndings } from "@/lib/planGenerationEndings.server";
import {
	buildPlanGenerationStops,
	planBudgetSummary,
	planRouteTimingDisclosure,
	planUsesPintPrices,
	type GroundedRouteTimingSummary,
} from "@/lib/planGenerationDto";
import {
	loadPlanGenerationBaselineWhatsOn,
	preparePlanGeneration,
	runAnchoredGeneration,
} from "@/lib/planGeneration.server";
import {
	planDietaryMenuWarning,
	planEvidenceWarning,
	planGenerationEvidenceGaps,
	planScoringDrinkCategory,
} from "@/lib/planGenerationRanking";
import { planGenerationRefusalMessage, selectPlanGenerationCandidates } from "@/lib/planGenerationSelection.server";
import { priceEvidenceUsableForCeiling, type PlanPriceEvidence } from "@/lib/planRouteEvidence";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import type { PlanConstraintReport, SelectedGroundedPlanStop } from "@/lib/planRouteOptimizer";
import type { PlanningIntentSource } from "@/lib/planningIntent";
import { mintPlanGroundingProof, mintPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import { planGroundingUnmintableResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { normalizePlanStopCount } from "@/lib/planStopCount";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * never creates a plan, records a location, or consumes a generation budget.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cityId = parseCityId(url.searchParams.get("cityId") ?? "") ?? DEFAULT_CITY_ID;
  await loadConciergeVenues(cityId);
  await loadPlanGenerationBaselineWhatsOn(Date.now()).catch((error) => {
    console.warn(
      "[plans/generate] What's-On warmup degraded:",
      error instanceof Error ? error.message : String(error),
    );
  });
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * The Culture Crawl cost sibling. A culture outing always has costs nobody has
 * priced: the POI layer holds no admission, and the planner holds no food or
 * fares. Its pint subtotal is therefore partial, and the whole night never
 * reads as within budget. An ordinary outing passes through unchanged.
 */
function cultureOutingFields(
	cultureOpener: CultureOpenerDTO | undefined,
	stops: readonly { venueId: string; venueName: string; priceEvidence: PlanPriceEvidence | null }[],
	limitPence: number | null,
	budgetSummary: PlanBudgetSummary,
) {
	if (!cultureOpener) return { cultureFields: {}, budgetSummary };
	const costs = cultureOutingCosts({
		limitPence,
		stops: stops.map((stop) => ({
			venueId: stop.venueId,
			venueName: stop.venueName,
			price: stop.priceEvidence && priceEvidenceUsableForCeiling(stop.priceEvidence) ? stop.priceEvidence : null,
		})),
	});
	return {
		cultureFields: { cultureOpener: { ...cultureOpener, costs } },
		budgetSummary: { ...budgetSummary, withinLimit: null },
	};
}

/**
 * The dry round's half of the response (lib/dryRound.ts): each pub's listed
 * alcohol-free price and, beside it, its pint from the same canonical evidence
 * a pint night carries, printed only where that pint names its publisher and
 * its day. It covers the stops and every swap offered, since a swap may only
 * bring in another pub that lists one. Nothing at all for any other night.
 */
async function dryRoundResponse(
	listed: ReadonlyMap<string, DryRoundAlcoholFree> | null,
	stops: readonly { venueId: string; alternatives: readonly { venueId: string }[] }[],
	venues: readonly ConciergeVenue[],
	now: number,
): Promise<{ fields: { dryRound?: DryRoundWire }; effects: string[] }> {
	if (!listed) return { fields: {}, effects: [] };
	const venueIds = stops.flatMap((stop) => [stop.venueId, ...stop.alternatives.map(({ venueId }) => venueId)]);
	const wanted = new Set(venueIds);
	const pints = await planPriceEvidenceForVenues(venues.filter(({ id }) => wanted.has(id)), now);
	return { fields: { dryRound: dryRoundWire(venueIds, listed, pints) }, effects: ["dryRound"] };
}

export async function POST(request: Request): Promise<Response> {
  try {
	const preparation = await preparePlanGeneration(request);
	if ("response" in preparation) return preparation.response;
	const {
		requestNow,
		operationKey,
		query,
		intake,
		context,
		reconciled,
		cityId,
		area,
		routeReady,
		coverage,
		planningWeather,
		reviewedSignalClaims,
		naLensPrices,
		drinkPriceCoverageNote,
		dietaryMenu,
		dryRoundListed,
		candidates,
		anchor: anchorRequest,
	} = preparation.prepared;
	type Candidate = (typeof candidates)[number];
	let groundedStops: readonly SelectedGroundedPlanStop<Candidate>[] | null = null;
	let groundedAlternatives: readonly (readonly SelectedGroundedPlanStop<Candidate>[])[] | null = null;
	let constraintReport: PlanConstraintReport | null = null;
	let groundedTiming: GroundedRouteTimingSummary | null = null;
	let accessibilityEnforced = false;
	let anchorContext: { anchorVenueId: string; anchorSource: PlanningIntentSource } | null = null;
	let chosen: Candidate[];
	// An accepted Venue is always authoritative for anchored generation. Requests
	// without one retain the generic, unanchored selection path.
	if (anchorRequest) {
		const anchored = await runAnchoredGeneration({
			cityId, anchor: anchorRequest, candidates, context, intake, requestNow, operationKey, area, coverage, dryRoundListed,
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
			// Name the words that refused it, so the reader knows what to drop,
			// or, under a budget, the cheapest route found and its total.
			const { mustHaves, cheapestRoute } = generatedSelection;
			return publicApiError(
				planGenerationRefusalMessage(context, area.name, mustHaves, cheapestRoute),
				"GROUNDED_CONSTRAINTS_UNSATISFIED",
				422,
				{ details: { nightArea: area.slug, availableVenueCount: candidates.length, mustHaves, cheapestRoute, ...generatedSelection.selection } },
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
	const requestedStopCount = normalizePlanStopCount(context.stopCount);
	if (chosen.length < requestedStopCount) return publicApiError(`Not enough listed pubs in ${area.name} to build a ${requestedStopCount}-stop route yet.`, "GROUNDED_VENUES_INSUFFICIENT", 422, { details: { nightArea: area.slug, availableVenueCount: chosen.length, requestedStopCount } });
	const pricePence = chosen.map(({ venue }, position) => {
		const grounded = groundedStops?.[position];
		if (grounded) return grounded.price.pence;
		return venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100);
	});
	const hasCompletePriceEvidence = planUsesPintPrices(context)
		&& pricePence.every((price): price is number => price !== null);
	const { contextEvidenceGaps, operationalEvidenceGaps } = planGenerationEvidenceGaps({
		context,
		accessibilityEnforced,
		hasDatedWindow: Boolean(intake?.routeWindow),
		allOpeningListed: Boolean(groundedStops?.every((stop) => stop.opening.state === "listed_open")),
		hasCompletePriceEvidence,
		allZeroProofConfirmed: chosen.every(({ venue }) => naLensPrices.has(venue.id)
			|| venue.amenities.nonAlcoholic === true
			|| dryRoundListed?.has(venue.id) === true),
		hasTonightEvidence: chosen.some(({ tonightEvents }) => tonightEvents.length > 0),
		hasWeatherEvidence: Boolean(planningWeather),
	});
	const missingEvidence = [...new Set([
		...area.missingEvidence,
		...contextEvidenceGaps,
		...operationalEvidenceGaps,
		...(drinkPriceCoverageNote ? ["selected_drink_price_index"] : []),
	])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(reconciled.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (missingEvidence.length ? "medium" : "high") : "low",
		score: Number(confidenceScore.toFixed(2)),
		routeReady,
		missingEvidence,
		warnings: [
			...missingEvidence.filter((gap) => gap !== "selected_drink_price_index").map(planEvidenceWarning),
			...(drinkPriceCoverageNote ? [drinkPriceCoverageNote] : []),
			...planDietaryMenuWarning(dietaryMenu, chosen.map(({ venue }) => venue.id)),
		],
		provenance: [
			{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" },
			{ kind: "night_area_review", label: `${area.name} route review`, asOf: area.lastReviewedAt },
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
	// upgrade the totals to a "routed" basis. A leg ORS does not route keeps the
	// street walk the optimiser chose it on (lib/pubWalkPairs) where the table
	// holds the pair, so the totals and the visit windows agree.
	const chosenWalkingStops = chosen.map(({ venue }) => ({ lat: venue.lat, lng: venue.lng, venueId: venue.id }));
	const walkingEstimate = await estimatePlanWalking(chosenWalkingStops, pubStreetWalkKm).catch(() =>
		estimateStraightLinePlanWalking(chosenWalkingStops, pubStreetWalkKm),
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
	// Culture Crawl opener: a free-standing thing to see before the first pint,
	// drawn from the ambient POI layer alone. It is never a Stop, never priced,
	// and never enters the grounding proof below, because the proof commits to
	// venue records and a POI is not one.
	const cultureOpenerFields = planCultureOpenerFields({
		query,
		cityId,
		stops: chosenWalkingStops,
	});
	const stops = buildPlanGenerationStops({
		chosen,
		candidates,
		groundedStops,
		groundedAlternatives,
		walkingEstimate,
		area,
		planningWeather,
		priceContext: context,
	});
	// A dry round prints each pub's listed alcohol-free price with its pint beside it.
	const dryRound = await dryRoundResponse(dryRoundListed, stops, candidates.map(({ venue }) => venue), requestNow);
	const { cultureFields, budgetSummary: routeBudgetSummary } = cultureOutingFields(
		cultureOpenerFields.cultureOpener,
		stops,
		context.budgetLimitPence,
		budgetSummary,
	);
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
		// A set the server cannot prove is a refusal about this request, so it
		// answers the same 422 the scarcity check above does rather than
		// escaping as a 500 (F-13).
		const unmintable = planGroundingUnmintableResponse(error, {
			nightArea: area.slug,
			availableVenueCount: chosen.length,
			requestedStopCount,
		});
		if (unmintable) return unmintable;
		throw error;
	}
  return jsonNoStore({
    // This response is assembled exclusively from the reviewed venue dataset
    // above and only exists when the requested canonical venue records were selected.
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
		budgetSummary: routeBudgetSummary,
		routeTotals,
		routeTiming: planRouteTimingDisclosure(groundedTiming),
		endingRecommendations,
		...cultureFields,
		...dryRound.fields,
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
			...dryRound.effects,
			...(planScoringDrinkCategory(context) && (context.budget === "value" || context.zeroProof) ? ["drinkCategory"] : []),
			...(context.wetherspoonsPreferred ? ["wetherspoonsPreferred"] : []),
			...(planningWeather ? ["weather"] : []),
	    ],
	    missingContextEvidence: contextEvidenceGaps,
	    relevantSignals: area.recentSignals,
		nightSignalClaims: reviewedSignalClaims.filter((claim) =>
			(claim.entity.type === "night_area" && claim.entity.id === area.slug) ||
			chosen.some(({ venue }) => claim.entity.type === "venue" && claim.entity.id === venue.id),
		),
	  });
  } catch (error) {
    console.error("plan_generate.unexpected_error", error);
    return publicApiError("Could not generate a route right now.", "PLAN_GENERATION_FAILED", 503, { retryable: true });
  }
}
