import "server-only";

import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { normalizePlanStopCount } from "@/lib/planStopCount";
import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import { isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { NO_ALCOHOL_DRINK_CATEGORIES, type CommunityPrice } from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { haversineKm } from "@/lib/haversine";
import { CATEGORY_META } from "@/lib/drinks";
import { drinkLensCoverageNote, readListedDrinkIndex, trustedDrinkLensPrices, trustedNoAlcoholLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
import {
	getNightArea,
	isNightAreaRouteReady,
	publicNightAreaCoverage,
	type NightArea,
} from "@/lib/nightAreas";
import type { NightContext } from "@/lib/nightPlanning";
import {
	canAffectRoute,
	claimsForEntity,
} from "@/lib/nightSignalClaims";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { isLimited } from "@/lib/pintDrops";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
import { resolvePlanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence.server";
import { listedServingGroup } from "@/lib/listedPriceComparison";
import { planUsesPintPrices } from "@/lib/planGenerationDto";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { scoreVenueForPlan } from "@/lib/planGenerationRanking";
import {
	parsePlanGenerationRequest,
	type PlanGenerationAnchor,
} from "@/lib/planGenerationRequest";
import {
	selectAnchoredPlanGenerationCandidates,
	type ScoredPlanCandidate,
} from "@/lib/planGenerationSelection.server";
import { planTemporalEvidence } from "@/lib/planGenerationTemporalEvidence";
import { mintPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import type {
	PlanConstraintReport,
	PlanRouteTiming,
	SelectedGroundedPlanStop,
} from "@/lib/planRouteOptimizer";
import { planSigningPreflightResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";
import type { PlanningIntentSource } from "@/lib/planningIntent";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/supabase";
import { ukPriceBundleCategoryIndex } from "@/lib/ukPriceBundle.server";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { loadServedWhatsOnListings } from "@/lib/whatsOnListings.server";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import weatherSnapshot from "@/public/data/weather/latest.json";

let bundledWhatsOn: WhatsOnRow[] | null = null;

export async function loadPlanGenerationBaselineWhatsOn(now: number): Promise<WhatsOnRow[]> {
	return loadServedWhatsOnListings({
		bundled: (bundledWhatsOn ??= loadBaselineWhatsOn()),
		now,
	});
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	return haversineKm([a.lng, a.lat], [b.lng, b.lat]);
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
export async function runAnchoredGeneration<T extends ScoredPlanCandidate & { selectedDrinkPrice?: MapLensPrice | null }>(params: {
	cityId: CityId;
	anchor: PlanGenerationAnchor;
	candidates: readonly T[];
	context: NightContext;
	intake: ParsedPlanGenerationIntake | null;
	requestNow: number;
	operationKey: string;
	area: NightArea;
	coverage: ReturnType<typeof publicNightAreaCoverage>;
	routeVenueIds?: readonly string[];
}): Promise<{ done: Response } | { route: AnchoredRouteData<T> }> {
	const { cityId, anchor, candidates, context, intake, requestNow, operationKey, area, coverage, routeVenueIds } = params;
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
	if (routeVenueIds && routeVenueIds[0] !== anchorVenueId) {
		return anchorConflict("ANCHOR_ROUTE_CONFLICT", "The accepted pub must stay as Stop 1. Keep it there or release it before changing the route.");
	}
	const selection = await selectAnchoredPlanGenerationCandidates(
		candidates,
		context,
		intake,
		requestNow,
		anchorVenueId,
		routeVenueIds,
	);
	if (routeVenueIds && (!selection.ok || selection.outcome !== "route")) {
		return { done: publicApiError("The selected stops no longer meet every must-have need. Keep this preview and change the stops or details.",
			"GROUNDED_CONSTRAINTS_UNSATISFIED", 422) };
	}
	if (!selection.ok && isNationalBaseVenueId(anchorVenueId)) {
		return baseAnchorOnlyResponse(anchorResolution, params);
	}
	if (!selection.ok) {
		return anchorConflict(
			"ANCHOR_ROUTE_CONFLICT",
			"We could not build a route from that pub right now. Try a different pub.",
		);
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
				estimatedPintPricePence: planUsesPintPrices(context) ? stop.price.pence : null,
				priceEvidence: planUsesPintPrices(context) ? stop.price : null,
				selectedDrinkPriceEvidence: selectedDrinkPriceEvidenceForPrice(selection.anchorValue.selectedDrinkPrice, context),
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
					{ kind: "night_area_review", label: `${area.name} route review`, asOf: area.lastReviewedAt },
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

type PlanGenerationCandidate = ScoredPlanCandidate & {
	distance: number;
	tonightEvents: WhatsOnRow[];
	reasons: string[];
	selectedDrinkPrice: MapLensPrice | null;
};

type PlanGenerationPreparation = {
	requestNow: number;
	operationKey: string;
	query: string;
	intake: ParsedPlanGenerationIntake | null;
	context: NightContext;
	reconciled: ReturnType<typeof reconcilePlanContext>;
	cityId: CityId;
	area: NightArea;
	routeReady: boolean;
	coverage: ReturnType<typeof publicNightAreaCoverage>;
	planningWeather: ReturnType<typeof planTemporalEvidence>["weather"];
	reviewedSignalClaims: ReturnType<typeof planTemporalEvidence>["signalClaims"];
	naLensPrices: ReturnType<typeof trustedNoAlcoholLensPrices>;
	drinkPriceCoverageNote: string | null;
	candidates: PlanGenerationCandidate[];
	anchor: PlanGenerationAnchor | null;
	routeVenueIds?: string[];
};

export async function preparePlanGeneration(
	request: Request,
	requestNow: number = Date.now(),
): Promise<{ response: Response } | { prepared: PlanGenerationPreparation }> {
	const parsedRequest = await parsePlanGenerationRequest(request, new Date(requestNow));
	if (!parsedRequest.ok) {
		return { response: publicApiError(parsedRequest.message, parsedRequest.code, parsedRequest.status) };
	}
	const { query, context: contextPatch, intake, routeVenueIds } = parsedRequest.value;
	const signingUnavailable = planSigningPreflightResponse();
	if (signingUnavailable) return { response: signingUnavailable };
	const operationKey = parsedRequest.value.operationKey ?? `create-${randomUUID()}`;
	const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
	if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
		return { response: publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true }) };
	}
	// The per-address budget above is one signal and a caller picks their own
	// address. This ceiling is the deployment's, and no header widens it. Plan
	// generation spends the routing budget as well as OpenRouter, so it is the
	// most expensive of the four lanes per call.
	const budgetRefusal = await paidSpendBudgetRefusal("plan-generate");
	if (budgetRefusal) return { response: budgetRefusal };
	if (intake?.unsupportedPatch) {
		return { response: publicApiError(
			"We cannot plan an exact route for this unmapped patch yet.",
			"NIGHT_PATCH_UNSUPPORTED",
			422,
			{ details: { patchId: intake.unsupportedPatch } },
		) };
	}
	if (!query && !contextPatch && !intake?.exactNightArea) {
		return { response: publicApiError(
			"Describe the outing or add its time, group and area.",
			"NIGHT_CONTEXT_REQUIRED",
			400,
		) };
	}
	const reconciled = reconcilePlanContext(query, contextPatch, intake, new Date(requestNow));
	const context = reconciled.context;
	if (routeVenueIds && routeVenueIds.length !== normalizePlanStopCount(context.stopCount)) {
		return { response: publicApiError("Selected stops must match the requested stop count.", "MALFORMED_REQUEST", 400) };
	}
	if (!context.nightArea) {
		return { response: publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422) };
	}
	const cityId = parsedRequest.value.cityId ? parseCityId(parsedRequest.value.cityId) : DEFAULT_CITY_ID;
	if (!cityId) {
		return { response: publicApiError("Choose a listed city.", "CITY_INVALID", 400) };
	}
	const area = getNightArea(context.nightArea);
	if (area.cityId !== cityId) {
		return { response: publicApiError("That area isn't in this city.", "NIGHT_AREA_CITY_MISMATCH", 422) };
	}
	const routeReady = isNightAreaRouteReady(area, new Date(requestNow));
	const coverage = publicNightAreaCoverage(area);
	const temporalEvidence = planTemporalEvidence({
		weatherSnapshot,
		nightSignalSnapshot,
		whatsOnRows: await loadPlanGenerationBaselineWhatsOn(requestNow),
		nightArea: area.slug,
		requestNow,
		routeWindow: intake?.routeWindow,
	});
	const { weather: planningWeather, whatsOn: tonightRows, signalClaims: reviewedSignalClaims } = temporalEvidence;
	if (claimsForEntity(reviewedSignalClaims, "night_area", area.slug)
		.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid")) {
		return { response: publicApiError(
			"Something's up in this area tonight, so we can't plan a crawl through it. Pick another area.",
			"NIGHT_AREA_CONSTRAINT_BLOCKED",
			422,
			{ details: { nightArea: area.slug } },
		) };
	}
	const tonightByVenue = new Map<string, WhatsOnRow[]>();
	for (const row of tonightRows) {
		if (!row.venueId) continue;
		const current = tonightByVenue.get(row.venueId) ?? [];
		current.push(row);
		tonightByVenue.set(row.venueId, current);
	}
	const acceptedHint = parsedRequest.value.anchor?.selectedDrinkPriceEvidence;
	let selectedServing: string | null = null;
	if (acceptedHint && !context.zeroProof && acceptedHint.category === context.drinkCategory) {
		const anchor = parsedRequest.value.anchor!;
		const canonical = await resolvePlanningAnchor({ cityId, venueId: anchor.venueId,
			startsAt: anchor.startsAt, acceptedArea: anchor.acceptedArea, now: requestNow });
		const rejectHint = (reason: string, message: string) => ({ response: jsonNoStore({
			grounded: false, outcome: "anchor-conflict", anchored: true, routeReady: false,
			stops: [], reason, message, operationKey, nightArea: { id: area.slug, ...coverage },
		}, { status: 200 }) });
		if (canonical.status === "conflict") return rejectHint(canonical.code, canonical.message);
		const [verified] = await resolvePlanSelectedDrinkPriceEvidence(
			[{ venueId: canonical.canonical.venueId, venueName: canonical.display.venueName }],
			[{ selectedDrinkPriceEvidence: acceptedHint }], context);
		const approved = verified?.selectedDrinkPriceEvidence;
		if (!approved) return rejectHint("ANCHOR_ROUTE_CONFLICT",
			"That accepted menu price could not be checked. Open the pub and choose its current offer again.");
		selectedServing = approved.source === "listed"
			? listedServingGroup(approved.category, approved.serving) : null;
	}
	const requestedCategory = !context.zeroProof && context.drinkCategory && context.drinkCategory !== "beer"
		? context.drinkCategory
		: null;
	const [categoryPriceRows, listedPriceIndex] = await Promise.all([
		readCommunityPriceCategoryIndex(
			[...NO_ALCOHOL_DRINK_CATEGORIES, ...(requestedCategory ? [requestedCategory] : [])],
			requestNow,
		).catch(() => ({ prices: [] as CommunityPrice[], truncated: false, degraded: true })),
		requestedCategory
			? ukPriceBundleCategoryIndex(requestedCategory, requestNow, selectedServing).catch(() => ({ prices: [], truncated: false, degraded: true }))
			: Promise.resolve(null),
	]);
	const priceRowsByVenue = new Map<string, CommunityPrice[]>();
	for (const row of categoryPriceRows.prices) {
		const current = priceRowsByVenue.get(row.venueId) ?? [];
		current.push(row);
		priceRowsByVenue.set(row.venueId, current);
	}
	const naLensPrices = trustedNoAlcoholLensPrices(priceRowsByVenue, requestNow);
	const drinkLensPrices = requestedCategory
		? trustedDrinkLensPrices(priceRowsByVenue, requestedCategory, requestNow)
		: undefined;
	const listedDrinkPricesByVenue = new Map<string, MapLensPrice>();
	if (requestedCategory && listedPriceIndex) {
		for (const price of readListedDrinkIndex(listedPriceIndex.prices, requestedCategory)) {
			if ((!selectedServing || listedServingGroup(requestedCategory, price.servingSize) === selectedServing)
				&& !listedDrinkPricesByVenue.has(price.venueId)) {
				listedDrinkPricesByVenue.set(price.venueId, price);
			}
		}
	}
	const drinkPriceCoverageNote = requestedCategory
		? drinkLensCoverageNote(
			CATEGORY_META[requestedCategory].label.toLowerCase(),
			categoryPriceRows.degraded || listedPriceIndex?.degraded
				? "degraded"
				: categoryPriceRows.truncated || listedPriceIndex?.truncated
					? "partial"
					: "ready",
		)
		: null;
	// Without a chosen, verified measure no non-beer GBP amount is a ranking signal.
	// Community reports retain their display lane; their null serving cannot join it.
	const comparableDrinkPrices = selectedServing ? listedDrinkPricesByVenue : undefined;
	const venues = await loadConciergeVenues(cityId);
	const wetherspoonsMatchedIds = context.wetherspoonsPreferred
		? await matchedWetherspoonsVenueIds(venues)
		: undefined;
	const candidates = venues
		.map((venue) => {
			const distance = distanceKm(area.centre, venue);
			const tonightEvents = tonightByVenue.get(venue.id) ?? [];
			const signalClaims = claimsForEntity(reviewedSignalClaims, "venue", venue.id);
			const scored = scoreVenueForPlan(
				venue,
				context,
				distance,
				tonightEvents,
				signalClaims,
				planningWeather,
				naLensPrices,
				wetherspoonsMatchedIds,
				comparableDrinkPrices,
			);
			return {
				venue,
				distance,
				tonightEvents,
				signalClaims,
				...scored,
				selectedDrinkPrice: selectedServing
					? listedDrinkPricesByVenue.get(venue.id) ?? null
					: drinkLensPrices?.get(venue.id) ?? listedDrinkPricesByVenue.get(venue.id) ?? null,
			};
		})
		.filter(({ distance, venue, signalClaims }) =>
			distance <= area.radiusKm
			&& venue.promoted !== true
			&& !signalClaims.some((claim) => canAffectRoute(claim) && claim.routeEffect === "avoid"))
		.sort((a, b) => b.score - a.score);
	return { prepared: {
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
		candidates,
		anchor: parsedRequest.value.anchor,
		...(routeVenueIds ? { routeVenueIds } : {}),
	} };
}

/** A canonical base pub is a grounded meetup, not a fabricated curated crawl candidate. */
async function baseAnchorOnlyResponse(
  anchor: Extract<Awaited<ReturnType<typeof resolvePlanningAnchor>>, { status: "resolved" }>,
  input: { context: NightContext; intake: ParsedPlanGenerationIntake | null; requestNow: number;
    operationKey: string; anchor: PlanGenerationAnchor; area: NightArea;
    coverage: ReturnType<typeof publicNightAreaCoverage> },
): Promise<{ done: Response }> {
  const { context, intake, requestNow, operationKey, area, coverage } = input;
  const coordinates = anchor.canonical.coordinates;
  const requiredAccess = context.accessibility.length > 0 || Boolean(intake?.handoff.accessibilityNeeds.length);
  const invalidArea = intake?.exactNightArea && (!coordinates || distanceKm(area.centre,
    { lat: coordinates.lat, lng: coordinates.lng }) > area.radiusKm);
  if (requiredAccess || context.budgetLimitPence !== null || invalidArea) {
    return { done: jsonNoStore({ grounded: false, outcome: "anchor-conflict", anchored: true, routeReady: false,
      stops: [], reason: requiredAccess ? "ANCHOR_ACCESS_CONFLICT" : invalidArea ? "ANCHOR_AREA_CONFLICT" : "ANCHOR_BUDGET_CONFLICT",
      message: "We cannot confirm that pub meets those plan requirements. Keep the requirements or choose another pub.",
      operationKey, nightArea: { id: area.slug, ...coverage } }, { status: 200 }) };
  }
  const id = anchor.canonical.venueId;
  const [approved] = await resolvePlanSelectedDrinkPriceEvidence(
    [{ venueId: id, venueName: anchor.display.venueName }],
    [{ selectedDrinkPriceEvidence: input.anchor.selectedDrinkPriceEvidence }], context);
  let proof: string;
  try { proof = mintPlanGroundingProofV2({ routeVenueIds: [id], allowedVenueIds: [id], anchorVenueId: id,
    anchorSource: input.anchor.source, outcome: "anchor-only", operationKey }, requestNow); }
  catch (error) { const unavailable = planSigningUnavailableResponse(error); if (unavailable) return { done: unavailable }; throw error; }
  return { done: jsonNoStore({ grounded: true, outcome: "anchor-only", anchored: true, routeReady: false,
    reason: "ANCHOR_COMPANIONS_INSUFFICIENT", anchorVenueId: id, anchorSource: input.anchor.source,
    groundingProof: proof, operationKey, inferredContext: context, nightArea: { id: area.slug, ...coverage },
    stops: [{ venueId: id, venueName: anchor.display.venueName, position: 0,
      estimatedPintPricePence: null, priceEvidence: null,
      selectedDrinkPriceEvidence: approved?.selectedDrinkPriceEvidence ?? null, accessEvidence: {},
      constraintFlags: [{ code: "opening_hours_unconfirmed", message: "Opening hours have not been confirmed." }],
      operationalEvidence: { openingAtVisit: "unknown", openingSource: null, visitWindow: null,
        transportBasis: "compact-straight-line" },
      provenance: [{ kind: "venue_dataset", label: "OpenStreetMap pub location", url: "https://www.openstreetmap.org/copyright" }],
      alternatives: [] }],
  }, { status: 200 }) };
}
