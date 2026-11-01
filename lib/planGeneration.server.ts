import "server-only";

import { randomUUID } from "node:crypto";

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId, type CityId } from "@/lib/cities";
import { NO_ALCOHOL_DRINK_CATEGORIES, type CommunityPrice } from "@/lib/communityPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { formatGbp } from "@/lib/formatGbp";
import { firstHttps } from "@/lib/httpUrl";
import { haversineKm } from "@/lib/haversine";
import { CATEGORY_META } from "@/lib/drinks";
import { drinkLensCoverageNote, trustedDrinkLensPrices, trustedNoAlcoholLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
import {
	getNightArea,
	isNightAreaRouteReady,
	publicNightAreaCoverage,
	type NightArea,
} from "@/lib/nightAreas";
import { planDietaryNeeds, type NightContext } from "@/lib/nightPlanning";
import {
	canAffectRoute,
	claimsForEntity,
} from "@/lib/nightSignalClaims";
import {
	PLAN_DRINK_ITEM,
	PLAN_FOOD_ITEM,
	PLAN_FOOD_SUBJECT,
	PLAN_PRICE_AMOUNT,
	PLAN_UNTYPED_ITEM_WORD,
	PLAN_VENUE_AMENITY,
	PLAN_VENUE_ITEM_LIMIT_PREFIX,
	planPriceAmounts,
	planPriceLimits,
	planPriceSubjectText,
} from "@/lib/planPriceLimits";
import { isLimited } from "@/lib/pintDrops";
import { reconcilePlanContext } from "@/lib/planGenerationContext";
import { selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import { priceEvidenceUsableForCeiling, type PlanPriceEvidence } from "@/lib/planRouteEvidence";
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
import { loadVenueMenuEnrichmentIndex } from "@/lib/venueMenuEnrichment";
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
	const { cityId, anchor, context, intake, requestNow, operationKey, area, coverage } = params;
	const candidates = anchor.venueIds
		? params.candidates.filter(({ venue }) => anchor.venueIds!.includes(venue.id))
		: params.candidates;
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
	if (anchor.venueIds && (candidates.length !== anchor.venueIds.length
		|| context.stopCount !== anchor.venueIds.length)) {
		return anchorConflict("ANCHOR_ROUTE_CONFLICT", "Some listed pubs cannot join this crawl. Review the list and try again.");
	}
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
	pintPriceEvidence: PlanPriceEvidence | null;
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
	/** The first dietary word named, and the pubs that publish a menu link. */
	dietaryMenu: { need: string; menuLinkVenueIds: ReadonlySet<string> } | null;
	candidates: PlanGenerationCandidate[];
	anchor: PlanGenerationAnchor | null;
};

const PLAN_ITEM_LIST_JOIN = String.raw`(?:\s*,\s*|\s*\b(?:and|plus)\b\s*|\s*[+&]\s*)(?:(?:an?|one|two)\s+)?`;

function isGenericFoodAmenity(value: string, item: RegExpExecArray): boolean {
	if (item[0].toLowerCase() !== "food") return false;
	const before = value.slice(0, item.index);
	const after = value.slice(item.index + item[0].length);
	const pricedOrBundled = new RegExp(String.raw`^[\s,]*(?:priced|cost(?:s|ing)?|for\s*${PLAN_PRICE_AMOUNT}|(?:and|plus|[+&])\s*(?:(?:an?|one|two)\s+)?${PLAN_DRINK_ITEM})\b`, "i");
	const amenity = new RegExp(String.raw`(?:\b(?:with|serving|serves)\s+|\b(?:serving|serves)\s+(?:(?!${PLAN_PRICE_AMOUNT}|[,;.!?])[\s\S])*(?:\b(?:and|plus)|[+&])\s*)$`, "i");
	return amenity.test(before) && !pricedOrBundled.test(after);
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
	return explicitFoodIntent
		&& new RegExp(String.raw`\b${PLAN_UNTYPED_ITEM_WORD}\s*(?:\b(?:and|plus)|[+&])\s*(?:(?:an?|one|two)\s+)?$`, "i").test(beforeDrink);
}

function pricedDrinkListIncludesMeal(afterDrink: string, explicitFoodIntent: boolean): boolean {
	const item = String.raw`(?:${PLAN_FOOD_SUBJECT}|${explicitFoodIntent ? PLAN_UNTYPED_ITEM_WORD : PLAN_DRINK_ITEM})`;
	const list = new RegExp(String.raw`^(?:${PLAN_ITEM_LIST_JOIN}${item}\b)+`, "i")
		.exec(afterDrink)?.[0] ?? "";
	if (!/\b(?:and|plus)\b|[+&]/i.test(list) || /^[\s,]*(?:afterwards|later)\b/i.test(afterDrink.slice(list.length))) return false;
	return explicitFoodIntent
		? list.split(/\W+/).some((word) => word && !new RegExp(String.raw`^(?:${PLAN_DRINK_ITEM}|and|plus|an?|one|two)$`, "i").test(word))
		: new RegExp(String.raw`\b${PLAN_FOOD_ITEM}\b`, "i").test(list);
}

function hasIndependentRouteBudgetClause(value: string, budgetClause: string, after: string): boolean {
	return (/^\s*(?:(?:a\s+)?budget(?:\s+of)?|under|below|up to|less than|max(?:imum)?)?\s*$/i.test(budgetClause)
		|| new RegExp(String.raw`${PLAN_VENUE_ITEM_LIMIT_PREFIX}$`, "i").test(budgetClause))
		&& (/^\s*(?:per\s+person|each)\b/i.test(after)
			|| (/\bserves\b/i.test(value) && /^\s*(?:,|$)/.test(after)));
}

function routeBudgetClause(before: string, prices: ReturnType<typeof planPriceAmounts>, priceIndex: number): string {
	const drinkClause = prices.filter((other) => other.drink && other.end <= priceIndex).at(-1);
	const clauses = before.slice(drinkClause ? drinkClause.end + (drinkClause.drink?.afterEnd ?? 0) : 0).split(/,(?!\d)/);
	return drinkClause && clauses.length === 1
		? (clauses[0] ?? "").replace(/^\s*(?:\b(?:and|plus)\b|[+&])/i, "")
		: clauses.at(-1) ?? "";
}

/** Bind each amount before exempting drink rates or a pub-route budget. */
function hasMealPriceConstraint(value: string, explicitFoodIntent = false): boolean {
	return planPriceSubjectText(value).split(/[;!?]|\.(?!\d)/).some((value) => {
		const foodItems = [...value.matchAll(new RegExp(String.raw`\b${PLAN_FOOD_ITEM}\b`, "gi"))]
			.filter((item) => !isGenericFoodAmenity(value, item));
		if (!foodItems.length && !explicitFoodIntent) return false;
		const foodAfterPrice = new RegExp(String.raw`^\s*(?:for\s+)?(?!\s|[+&]|(?:with|and|plus|per|each|afterwards|later)\b)${PLAN_FOOD_SUBJECT}`, "i");
		const prices = planPriceAmounts(value);
		return prices.some((price) => {
			const before = value.slice(0, price.index);
			const after = value.slice(price.end);
			if (price.drink?.perServing) return false;
			if (price.drink) {
				const afterDrink = after.slice(price.drink.afterEnd ?? 0);
				if (foodAfterPrice.test(afterDrink)) return true;
				if (price.drink.beforeStart !== null
					&& pricedDrinkIncludesMeal(before.slice(0, price.drink.beforeStart), explicitFoodIntent)) return true;
				return pricedDrinkListIncludesMeal(afterDrink, explicitFoodIntent);
			}
			if (foodAfterPrice.test(after)) return true;
			const budgetClause = routeBudgetClause(before, prices, price.index);
			if (/\b(?:pubs?|bars?|stops?|crawl|route)\b/i.test(budgetClause)
				&& /\b(?:and|with)\s+(?:a\s+)?budget(?:\s+of)?\s*$/i.test(budgetClause)) return false;
			if (price.routeBudget === "explicit"
				|| (price.routeBudget === "limit" && new RegExp(String.raw`^\s*(?:for\s+)?${PLAN_VENUE_AMENITY}`, "i").test(after))) return false;
			if (price.routeBudget === "limit" && hasIndependentRouteBudgetClause(value, budgetClause, after)
				&& foodItems.every((item) => /\bserves\b[^,;!?]*$/i.test(value.slice(0, item.index)))) return false;
			if (!foodItems.length && /\b(?:with|serving|serves)\s+food[\s,]*(?:(?:a\s+)?budget(?:\s+of)?|under|below|up to|less than|max(?:imum)?)\s*$/i.test(before)) return false;
			const foodIsLaterPreference = foodItems.length > 0 && foodItems.every((item) =>
				/^[\s,]*(?:afterwards|later)\b/i.test(value.slice(item.index + item[0].length)));
			if (/^\s*(?:per\s+person|each)\b/i.test(after) && foodIsLaterPreference) return false;
			// An unpriced amenity after a drink rate cannot own a later comma-separated route limit.
			if (price.routeBudget === "limit"
				&& foodItems.length > 0 && foodItems.every((item) => prices.some((drinkPrice) =>
					drinkPrice.drink && drinkPrice.end < item.index && item.index < before.lastIndexOf(",")
					&& /^\s*(?:with|serving|serves)\b/i.test(value.slice(drinkPrice.end, item.index))
					&& !/[,;!?£]|\.(?!\d)/.test(value.slice(drinkPrice.end, item.index))))) return false;
			if (price.routeBudget === "limit"
				&& foodItems.length > 0 && foodItems.every((item) => item.index > price.index)
				&& (/\b(?:pubs?|bars?|stops?|crawl|route)\b/i.test(budgetClause)
					|| /^\s*(?:(?:per\s+person|each)\s*)?(?:with\b|,)/i.test(after) || foodIsLaterPreference)) return false;
			return true;
		});
	});
}

/**
 * The pub-route generator has no menu-item or nutrition proof, so a meal price
 * or a calorie count is refused. A dietary word is not: it degrades to a
 * preference for pubs that publish a menu link and a warning
 * (planDietaryNeeds, planDietaryMenuWarning).
 */
function requiresMenuEvidence(query: string, foodNeeds: readonly string[]): boolean {
	const foodRequests = [query, ...foodNeeds];
	const requiresNutrition = foodRequests.some((foodRequest) => /(?:\b|\d)(?:calories?|kcals?|kilocalories?)\b/i.test(foodRequest));
	const requiresMealPrice = hasMealPriceConstraint(query)
		|| foodNeeds.some((value) => hasMealPriceConstraint(value, true));
	return requiresNutrition || requiresMealPrice;
}

/** Add every dietary word named to foodNeeds, and return them in order. */
function withDietaryNeeds(query: string, context: NightContext): string[] {
	const needs = planDietaryNeeds(query, ...context.foodNeeds);
	for (const need of needs) if (!context.foodNeeds.includes(need)) context.foodNeeds.push(need);
	return needs;
}

/** Venue ids whose curated record carries a safe https menu link. */
async function menuLinkVenueIds(): Promise<ReadonlySet<string>> {
	const index = await loadVenueMenuEnrichmentIndex();
	const ids = new Set<string>();
	for (const [venueId, record] of index) {
		if (firstHttps(record.menuUrl)) ids.add(venueId);
	}
	return ids;
}

function applyStrictestRouteBudget(
	reconciled: ReturnType<typeof reconcilePlanContext>,
	routeBudgetPence: number | null,
): void {
	const { context } = reconciled;
	if (routeBudgetPence !== null
		&& (context.budgetLimitPence === null || routeBudgetPence < context.budgetLimitPence)) {
		context.budgetLimitPence = routeBudgetPence;
		reconciled.fieldSources.budgetLimitPence = "context";
		reconciled.reasons = reconciled.reasons.filter(({ field }) => field !== "budgetLimitPence");
		reconciled.reasons.push({
			field: "budgetLimitPence",
			evidence: formatGbp(routeBudgetPence / 100),
			explanation: "Applied the strictest requested route budget.",
		});
	}
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
			"Say where, how many and what budget, or add a time, group and area.",
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
	const dietaryNeeds = withDietaryNeeds(query, context);
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
	applyStrictestRouteBudget(reconciled, priceLimits.routeBudgetPence);
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
	// Every plan needs to know which pubs are Wetherspoon branches, so a route
	// takes one of them rather than three (`oneStopPerOperator`). Only a request
	// that asks for Spoons also earns the scoring boost.
	const wetherspoonBranchIds = await matchedWetherspoonsVenueIds(venues);
	const wetherspoonsMatchedIds = context.wetherspoonsPreferred ? wetherspoonBranchIds : undefined;
	const cappedVenues = pintCap === null ? venues : venues.flatMap((venue) => {
		const price = pintEvidence!.get(venue.id);
		return price && priceEvidenceUsableForCeiling(price) && price.pence! <= Math.round(pintCap * 100)
			? [{ ...venue, cheapestPrice: price.pence! / 100 }]
			: [];
	});
	const dietaryMenu = dietaryNeeds.length > 0
		? { need: dietaryNeeds[0]!, menuLinkVenueIds: await menuLinkVenueIds() }
		: null;
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
				dietaryMenu?.menuLinkVenueIds,
			);
			return { venue, distance, tonightEvents, signalClaims, ...scored, selectedDrinkPrice: drinkLensPrices?.get(venue.id) ?? null,
				pintPriceEvidence: pintEvidence?.get(venue.id) ?? null,
				operator: wetherspoonBranchIds.has(venue.id) ? "wetherspoon" : null };
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
		dietaryMenu,
		candidates,
		anchor: parsedRequest.value.anchor,
	} };
}
