import "server-only";

import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import { NO_ALCOHOL_DRINK_CATEGORIES, type CommunityPrice } from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { formatGbp } from "@/lib/formatGbp";
import { haversineKm } from "@/lib/haversine";
import { CATEGORY_META } from "@/lib/drinks";
import { drinkLensCoverageNote, trustedDrinkLensPrices, trustedNoAlcoholLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
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
import { PLAN_DRINK_ITEM, PLAN_PRICE_AMOUNT, planPriceAmounts, planPriceLimits } from "@/lib/planPriceLimits";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { isLimited } from "@/lib/pintDrops";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { planUsesPintPrices } from "@/lib/planGenerationDto";
import type { ParsedPlanGenerationIntake } from "@/lib/planGenerationIntake";
import { planScoringDrinkCategory, scoreVenueForPlan } from "@/lib/planGenerationRanking";
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
	const selection = await selectAnchoredPlanGenerationCandidates(
		candidates,
		context,
		intake,
		requestNow,
		anchorVenueId,
	);
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
};

const PLAN_FOOD_ITEM = String.raw`(?:meals?|lunch|dinner|breakfast|dish(?:es)?|food|eat|pizzas?|burgers?|kebabs?|chips|(?:Sunday\s+)?roasts?|steaks?|sandwich(?:es)?|salads?|curr(?:y|ies))`;
const PLAN_FOOD_QUANTITY = String.raw`(?:(?:an?|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen)[ -]+)*`;
const PLAN_ITEM_LIST_JOIN = String.raw`(?:\s*,\s*|\s*\b(?:and|plus)\b\s*|\s*[+&]\s*)(?:(?:an?|one|two)\s+)?`;

function isGenericFoodAmenity(value: string, item: RegExpExecArray): boolean {
	if (item[0].toLowerCase() !== "food") return false;
	const before = value.slice(0, item.index);
	const after = value.slice(item.index + item[0].length);
	const pricedOrBundled = new RegExp(String.raw`^[\s,]*(?:priced|cost(?:s|ing)?|for\s*${PLAN_PRICE_AMOUNT}|(?:and|plus|[+&])\s*(?:(?:an?|one|two)\s+)?${PLAN_DRINK_ITEM})\b`, "i");
	return /\b(?:with|serving|serves)\s+$/i.test(before) && !pricedOrBundled.test(after);
}

function pricedDrinkIncludesMeal(beforeDrink: string, explicitFoodIntent: boolean): boolean {
	const items = [...beforeDrink.matchAll(new RegExp(String.raw`\b(?:${PLAN_FOOD_ITEM}|${PLAN_DRINK_ITEM})\b`, "gi"))].reverse();
	let nextItemStart = beforeDrink.length;
	for (const [index, item] of items.entries()) {
		const join = beforeDrink.slice(item.index + item[0].length, nextItemStart);
		// A comma before a newly priced drink starts its own price phrase.
		if (index === 0 && !/\b(?:and|plus)\b|[+&]/i.test(join)) return false;
		if (/[;.!?]/.test(join)) return false;
		if (index > 0 && !/^[\s,]*(?:(?:and|plus|[+&])\s*)?(?:(?:an?|one|two|three|four|five|six|\d+)\s*)?$/i.test(join)) return false;
		if (new RegExp(String.raw`^${PLAN_FOOD_ITEM}$`, "i").test(item[0])) {
			return !/\b(?:afterwards|later)\b/i.test(join);
		}
		nextItemStart = item.index;
	}
	return explicitFoodIntent && /(?:\b(?:and|plus)|[+&])\s*(?:(?:an?|one|two)\s+)?$/i.test(beforeDrink);
}

/** Bind each amount before exempting drink rates or a pub-route budget. */
function hasMealPriceConstraint(value: string, explicitFoodIntent = false): boolean {
	return value.split(/[;!?]|\.(?!\d)/).some((value) => {
		const foodItems = [...value.matchAll(new RegExp(String.raw`\b${PLAN_FOOD_ITEM}\b`, "gi"))]
			.filter((item) => !isGenericFoodAmenity(value, item));
		if (!foodItems.length && !explicitFoodIntent) return false;
		const foodAfterPrice = new RegExp(String.raw`^\s*(?:for\s+)?${PLAN_FOOD_QUANTITY}(?:(?:slices?|portions?)\s+of\s+${PLAN_FOOD_QUANTITY})?${PLAN_FOOD_ITEM}\b`, "i");
		return planPriceAmounts(value).some((price) => {
			const before = value.slice(0, price.index);
			const after = value.slice(price.end);
			if (price.drink?.perServing) return false;
			if (foodAfterPrice.test(after)) return true;
			const budgetClause = before.split(/,(?!\d)/).at(-1) ?? "";
			if (/\b(?:pubs?|bars?|stops?|crawl|route)\b/i.test(budgetClause)
				&& /\b(?:and|with)\s+(?:a\s+)?budget(?:\s+of)?\s*$/i.test(budgetClause)) return false;
			if (price.drink && price.drink.beforeStart !== null) {
				return pricedDrinkIncludesMeal(before.slice(0, price.drink.beforeStart), explicitFoodIntent);
			}
			if (price.drink && price.drink.afterEnd !== null) {
				const item = explicitFoodIntent ? String.raw`\w+` : String.raw`(?:${PLAN_FOOD_ITEM}|${PLAN_DRINK_ITEM})`;
				const list = new RegExp(String.raw`^(?:${PLAN_ITEM_LIST_JOIN}${item}\b)+`, "i")
					.exec(after.slice(price.drink.afterEnd))?.[0] ?? "";
				if (!/\b(?:and|plus)\b|[+&]/i.test(list)) return false;
				return explicitFoodIntent
					? list.split(/\W+/).some((word) => word && !new RegExp(String.raw`^(?:${PLAN_DRINK_ITEM}|and|plus|an?|one|two)$`, "i").test(word))
					: new RegExp(String.raw`\b${PLAN_FOOD_ITEM}\b`, "i").test(list);
			}
			if (price.routeBudget === "explicit") return false;
			if (!foodItems.length && /\b(?:with|serving|serves)\s+food[\s,]*(?:(?:a\s+)?budget(?:\s+of)?|under|below|up to|less than|max(?:imum)?)\s*$/i.test(before)) return false;
			const foodIsLaterPreference = foodItems.length > 0 && foodItems.every((item) =>
				/^[\s,]*(?:afterwards|later)\b/i.test(value.slice(item.index + item[0].length)));
			if (/^\s*(?:per\s+person|each)\b/i.test(after) && foodIsLaterPreference) return false;
			if ((foodItems.length > 0 && foodItems.every((item) => item.index > price.index))
				&& /\b(?:pubs?|bars?|stops?|crawl|route)\b/i.test(before)) return false;
			return true;
		});
	});
}

/** The pub-route generator has no menu-item or nutrition proof. */
function requiresMenuEvidence(query: string, foodNeeds: readonly string[]): boolean {
	const foodRequests = [query, ...foodNeeds];
	const requiresNutrition = foodRequests.some((foodRequest) => /(?:\b|\d)(?:calories?|kcals?|kilocalories?)\b/i.test(foodRequest));
	const allergens = "(?:gluten|nuts?|peanuts?|dairy|milk|lactose|eggs?|soy|soya|sesame|shellfish|wheat)";
	const requiresDiet = foodRequests.some((foodRequest) => new RegExp(`\\b(?:vegan|vegetarian|pescatarian|halal|kosher|coeliac|celiac|${allergens}[ -]free|(?:without|no|avoid|free\\s+(?:of|from))\\s+${allergens}|allerg(?:y|ies|ic|en|ens)|intoleran(?:t|ce))\\b`, "i").test(foodRequest));
	const requiresMealPrice = hasMealPriceConstraint(query)
		|| foodNeeds.some((value) => hasMealPriceConstraint(value, true));
	return requiresNutrition || requiresDiet || requiresMealPrice;
}

export async function preparePlanGeneration(
	request: Request,
	requestNow: number = Date.now(),
): Promise<{ response: Response } | { prepared: PlanGenerationPreparation }> {
	const parsedRequest = await parsePlanGenerationRequest(request, new Date(requestNow));
	if (!parsedRequest.ok) {
		return { response: publicApiError(parsedRequest.message, parsedRequest.code, parsedRequest.status) };
	}
	const { query, context: contextPatch, intake } = parsedRequest.value;
	const signingUnavailable = planSigningPreflightResponse();
	if (signingUnavailable) return { response: signingUnavailable };
	const operationKey = parsedRequest.value.operationKey ?? `create-${randomUUID()}`;
	const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
	if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
		return { response: publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true }) };
	}
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
	if (requiresMenuEvidence(query, context.foodNeeds)) {
		return { response: publicApiError(
			"This route planner cannot verify meal prices, dietary requirements or calories. Use the food map for sourced menu items.",
			"MEAL_CONSTRAINTS_UNSUPPORTED",
			422,
		) };
	}
	if (!context.nightArea) {
		return { response: publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422) };
	}
	const priceInputs = [query, ...context.foodNeeds];
	if (priceInputs.some((value) => planPriceAmounts(value).some(({ drink }) =>
		drink && (!drink.supported || !planUsesPintPrices(context))))) {
		return { response: publicApiError(
			"This route planner can check these drink limits only against recorded beer pint prices. Choose pints or remove the unsupported drink or serving limit.",
			"DRINK_PRICE_CONSTRAINTS_UNSUPPORTED",
			422,
		) };
	}
	const priceLimits = planPriceLimits(...priceInputs);
	if (priceLimits.routeBudgetPence !== null
		&& (context.budgetLimitPence === null || priceLimits.routeBudgetPence < context.budgetLimitPence)) {
		context.budgetLimitPence = priceLimits.routeBudgetPence;
		reconciled.fieldSources.budgetLimitPence = "context";
		reconciled.reasons = reconciled.reasons.filter(({ field }) => field !== "budgetLimitPence");
		reconciled.reasons.push({
			field: "budgetLimitPence",
			evidence: formatGbp(priceLimits.routeBudgetPence / 100),
			explanation: "Applied the strictest requested route budget.",
		});
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
	const budgetRefusal = await paidSpendBudgetRefusal("plan-generate");
	if (budgetRefusal) return { response: budgetRefusal };
	const tonightByVenue = new Map<string, WhatsOnRow[]>();
	for (const row of tonightRows) {
		if (!row.venueId) continue;
		const current = tonightByVenue.get(row.venueId) ?? [];
		current.push(row);
		tonightByVenue.set(row.venueId, current);
	}
	const requestedCategory = planScoringDrinkCategory(context);
	const requestedCategories = [...new Set([
		...NO_ALCOHOL_DRINK_CATEGORIES,
		...(requestedCategory ? [requestedCategory] : []),
	])];
	const categoryPriceRows = await readCommunityPriceCategoryIndex(
		requestedCategories,
		requestNow,
	);
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
	const drinkPriceCoverageNote = requestedCategory
		? drinkLensCoverageNote(
			CATEGORY_META[requestedCategory].label.toLowerCase(),
			categoryPriceRows.degraded ? "degraded" : categoryPriceRows.truncated ? "partial" : "ready",
		)
		: null;
	const venues = await loadConciergeVenues(cityId);
	const pintCap = priceLimits.pintCeiling;
	const pintEvidence = pintCap === null ? null : await planPriceEvidenceForVenues(venues, requestNow);
	const wetherspoonsMatchedIds = context.wetherspoonsPreferred
		? await matchedWetherspoonsVenueIds(venues)
		: undefined;
	const cappedVenues = pintCap === null ? venues : venues.flatMap((venue) => {
		const price = pintEvidence!.get(venue.id);
		return price && priceEvidenceUsableForCeiling(price) && price.pence! <= Math.round(pintCap * 100)
			? [{ ...venue, cheapestPrice: price.pence! / 100 }]
			: [];
	});
	const candidates = cappedVenues
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
				drinkLensPrices,
			);
			return { venue, distance, tonightEvents, signalClaims, ...scored, selectedDrinkPrice: drinkLensPrices?.get(venue.id) ?? null };
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
	} };
}
