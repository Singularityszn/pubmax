import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { cleanNightContext, cleanNightContextPatch, inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanningConfidence, PlanRouteTotals } from "@/lib/planIntelligence";
import { buildPlanEndingRecommendations } from "@/lib/planEndings";
import { getLateFoodForArea, normalizeLateFoodArea } from "@/lib/lateFood";
import { filterTonight, type WhatsOnRow } from "@/lib/whatsOn";
import { loadBaselineWhatsOn } from "@/lib/whatsOnStore";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import {
	activeNightSignalClaims,
	canAffectRoute,
	claimsForEntity,
	type NightSignalClaim,
} from "@/lib/nightSignalClaims";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/supabase";
import { planningWeatherForArea, type PlanningWeather } from "@/lib/weatherSnapshots";
import weatherSnapshot from "@/public/data/weather/latest.json";

assertServerEnv();

let baselineWhatsOn: WhatsOnRow[] | null = null;

function baselineTonight(now: number): WhatsOnRow[] {
  baselineWhatsOn ??= loadBaselineWhatsOn();
  return filterTonight(baselineWhatsOn, now);
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	return haversineKm([a.lng, a.lat], [b.lng, b.lat]);
}

function mergeContext(inferred: NightContext, raw: unknown): NightContext {
  const complete = cleanNightContext(raw);
  if (complete) return complete;
  const patch = cleanNightContextPatch(raw);
  return patch ? { ...inferred, ...patch } : inferred;
}

function scoreVenueForContext(
	venue: Awaited<ReturnType<typeof loadConciergeVenues>>[number],
	context: NightContext,
	distance: number,
	tonightEvents: readonly WhatsOnRow[],
	signalClaims: readonly NightSignalClaim[],
	weather: PlanningWeather | null,
): { score: number; reasons: string[] } {
	const reasons: string[] = [];
	const price = venue.cheapestPrice;
	let score = -distance * (context.daypart === "late_night" || context.daypart === "get_home" ? 3 : 2);

	if (context.budget === "value") {
		const boost = price === null ? 0 : Math.max(0, 7 - price);
		score += boost;
		if (price !== null) reasons.push(`pints from £${price.toFixed(2)}`);
	} else if (context.budget === "treat" && (venue.amenities.cocktails || venue.hasStory)) {
		score += 1.5;
		reasons.push("fits a treat-night brief");
	}
	if (context.budgetLimitPence && price !== null) {
		const perStopLimit = context.budgetLimitPence / 300;
		if (price <= perStopLimit) {
			score += 1.25;
			reasons.push("fits the explicit route budget");
		} else {
			score -= Math.min(3, price - perStopLimit);
		}
	}
	if (context.zeroProof) {
		if (venue.amenities.nonAlcoholic === true) {
			score += 3;
			reasons.push("confirmed 0.0 option in the Venue Dataset");
		} else {
			score -= 2;
		}
	}

	if (context.daypart === "after_work" && venue.canonical) {
		score += 1.25;
		reasons.push("reliable after-work anchor");
	}
	if ((context.daypart === "late_night" || context.daypart === "get_home") && venue.amenities.food) {
		score += 1.5;
		reasons.push("food-aware late stop");
	}
	if (context.partyType === "work" && venue.amenities.food) {
		score += 1;
		reasons.push("works for a group with food backup");
	}
	if ((context.groupSize ?? 0) >= 5 && venue.canonical) {
		score += 0.75;
		reasons.push("safer pick for a bigger group");
	}
	if (context.foodNeeds.length > 0 && venue.amenities.food) {
		score += 2;
		reasons.push("matched the food need at venue level");
	}
	if (context.atmosphere.includes("historic") && venue.hasStory) {
		score += 2;
		reasons.push("historic character");
	}
	if (context.atmosphere.includes("garden") && venue.amenities.beerGarden) {
		if (weather?.kind === "warm-dry") {
			score += 2;
			reasons.push(`beer garden on record; cached ${weather.source.publisher} weather supports it`);
		} else if (weather?.kind === "rainy" || weather?.kind === "cold") {
			score -= 1.5;
			reasons.push(`beer garden on record; cached weather is ${weather.kind}`);
		} else {
			score += 0.75;
			reasons.push("beer garden on record; weather evidence is unavailable or inconclusive");
		}
	}
	if (context.atmosphere.includes("sports") && venue.amenities.liveSports) {
		score += 1.5;
		reasons.push("sports-friendly");
	}
	if ((context.atmosphere.includes("music") || context.atmosphere.includes("lively")) && venue.amenities.liveMusic) {
		score += 1.25;
		reasons.push("livelier atmosphere signal");
	}
	if (context.atmosphere.includes("quiet") && (venue.amenities.liveMusic || venue.amenities.liveSports)) {
		score -= 2;
	}
	for (const event of tonightEvents) {
		const matchesBrief =
			(event.kind === "music" && (context.atmosphere.includes("music") || context.atmosphere.includes("lively"))) ||
			(event.kind === "sport" && context.atmosphere.includes("sports"));
		score += matchesBrief ? 2 : 0.5;
		reasons.push(`Tonight: ${event.title} (${event.confidence})`);
	}
	for (const signal of signalClaims) {
		if (canAffectRoute(signal)) score += signal.routeEffect === "boost" ? 2 : -3;
		reasons.push(`Reviewed signal: ${signal.claim}`);
	}

	return { score, reasons };
}

function evidenceWarning(code: string): string {
	return `Check ${code.replaceAll("_", " ")} before relying on this route.`;
}

function missingContextEvidence(context: NightContext): string[] {
	const missing = new Set<string>();
	if (context.accessibility.length > 0) missing.add("venue_accessibility");
	if (context.transportConstraints.length > 0) missing.add("per_venue_transport");
	if (context.zeroProof) missing.add("zero_proof_options");
	if (context.foodNeeds.some((need) => ["kebab", "halal", "vegan", "vegetarian"].includes(need))) {
		missing.add("food_terminal_specificity");
	}
	return [...missing];
}

/**
 * Best-effort planning warmup. It loads only the stable public venue index and
 * never creates a plan, records a location, or consumes a generation budget.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cityId = parseCityId(url.searchParams.get("cityId") ?? "") ?? DEFAULT_CITY_ID;
  await loadConciergeVenues(cityId);
  baselineTonight(Date.now());
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  const limiterKey = `plan-generate:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) return publicApiError("Too many requests.", "RATE_LIMITED", 429, { retryable: true });
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query && !body.context) return publicApiError("Describe the night or provide Night Context.", "NIGHT_CONTEXT_REQUIRED", 400);
  const inferred = inferNightContext(query);
  const context = mergeContext(inferred.context, body.context);
  if (!context.nightArea) return publicApiError("Choose an area.", "NIGHT_AREA_REQUIRED", 422);
  const cityId = typeof body.cityId === "string" ? parseCityId(body.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("cityId is invalid.", "CITY_INVALID", 400);
  const area = getNightArea(context.nightArea);
  if (area.cityId !== cityId) return publicApiError("That area isn't in this city.", "NIGHT_AREA_CITY_MISMATCH", 422);
	const routeReady = isNightAreaRouteReady(area);
	const coverage = publicNightAreaCoverage(area);
	const requestNow = Date.now();
	const planningWeather = planningWeatherForArea(weatherSnapshot, area.slug, requestNow);
	const tonightRows = baselineTonight(requestNow);
	const reviewedSignalClaims = activeNightSignalClaims(nightSignalSnapshot, requestNow);
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
	      const scored = scoreVenueForContext(venue, context, distance, tonightEvents, signalClaims, planningWeather);
	      return { venue, distance, tonightEvents, signalClaims, ...scored };
	    })
    .filter(({ distance }) => distance <= area.radiusKm)
    .sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 3);
  if (chosen.length < 3) return publicApiError(`Not enough grounded venues are available in ${area.name} yet.`, "GROUNDED_VENUES_INSUFFICIENT", 422, { details: { nightArea: area.slug, availableVenueCount: chosen.length } });
	const contextEvidenceGaps = missingContextEvidence(context);
	const operationalEvidenceGaps = ["current_opening_hours"];
	if ((context.groupSize ?? 1) > 1) operationalEvidenceGaps.push("get_in_estimates");
	if (
		context.atmosphere.some((value) => ["lively", "music", "sports"].includes(value)) &&
		chosen.every(({ tonightEvents }) => tonightEvents.length === 0)
	) operationalEvidenceGaps.push("tonight_event_evidence");
	if (context.atmosphere.includes("garden") && !planningWeather) operationalEvidenceGaps.push("live_weather");
	if ((context.budgetLimitPence || context.budget === "value") && chosen.some(({ venue }) => venue.cheapestPrice === null)) {
		contextEvidenceGaps.push("price_evidence");
	}
	if (context.zeroProof && chosen.every(({ venue }) => venue.amenities.nonAlcoholic === true)) {
		const zeroProofGap = contextEvidenceGaps.indexOf("zero_proof_options");
		if (zeroProofGap >= 0) contextEvidenceGaps.splice(zeroProofGap, 1);
	}
	const missingEvidence = [...new Set([...area.missingEvidence, ...contextEvidenceGaps, ...operationalEvidenceGaps])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(inferred.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (missingEvidence.length ? "medium" : "high") : "low",
		score: Number(confidenceScore.toFixed(2)),
		routeReady,
		missingEvidence,
		warnings: missingEvidence.map(evidenceWarning),
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
	const prices = chosen.map(({ venue }) => venue.cheapestPrice);
	const hasCompletePriceEvidence = prices.every((price): price is number => price !== null);
	const estimatedPerPersonPence = hasCompletePriceEvidence
		? prices.reduce((total, price) => total + Math.round(price * 100), 0)
		: null;
	const budgetSummary: PlanBudgetSummary = {
		currency: "GBP",
		limitPence: context.budgetLimitPence,
		estimatedPerPersonPence,
		estimatedCrewPence: estimatedPerPersonPence === null ? null : estimatedPerPersonPence * Math.max(1, context.groupSize ?? 1),
		withinLimit: context.budgetLimitPence === null || estimatedPerPersonPence === null ? null : estimatedPerPersonPence <= context.budgetLimitPence,
		basis: "one-recorded-pint-per-stop",
	};
	let straightLineWalkingKm = 0;
	for (let index = 0; index < chosen.length - 1; index += 1) {
		straightLineWalkingKm += distanceKm(chosen[index].venue, chosen[index + 1].venue);
	}
	const routeTotals: PlanRouteTotals = {
		stopCount: chosen.length,
		straightLineWalkingKm: Number(straightLineWalkingKm.toFixed(2)),
		estimatedWalkingMinutes: Math.ceil((straightLineWalkingKm / 4.8) * 60),
		distanceBasis: "straight-line",
	};
	const lastStop = chosen.at(-1)?.venue;
	const extensions = candidates.slice(3, 5).map(({ venue }) => ({
		venueId: venue.id,
		venueName: venue.name,
		distanceKm: lastStop ? distanceKm(lastStop, venue) : 0,
		estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
	}));
	const lateFoodArea = normalizeLateFoodArea(area.slug);
	const rankedLateFood = lateFoodArea ? getLateFoodForArea(lateFoodArea, context.foodNeeds, {
		from: lastStop ? { lat: lastStop.lat, lng: lastStop.lng } : null,
		now: requestNow,
	}) : [];
	const endingRecommendations = buildPlanEndingRecommendations({
		daypart: context.daypart,
		foodRequested: context.foodNeeds.length > 0,
		transportAnchor: area.transportAnchors[0] ?? area.name,
		lateFood: rankedLateFood,
		extensions,
	});
	const nightArea = { id: area.slug, ...coverage };
  return jsonNoStore({
    // This response is assembled exclusively from the reviewed venue dataset
    // above and only exists when three canonical venue records were selected.
    // The explicit flag lets clients distinguish server-grounded generation
    // from a manual draft without guessing from unrelated revision metadata.
    grounded: true,
    inferredContext: context,
    confidence: inferred.confidence,
		planningConfidence,
		budgetSummary,
		routeTotals,
		endingRecommendations,
		weatherEvidence: planningWeather,
		nightArea,
		// Back-compatible alias until every client has moved to Night Area.
		district: nightArea,
    explanations: inferred.reasons,
	    stops: chosen.map(({ venue, distance, reasons, tonightEvents, signalClaims }, index) => ({
	      venueId: venue.id,
	      venueName: venue.name,
	      position: index,
			distanceKm: Number(distance.toFixed(2)),
			estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
			evidence: reasons,
			provenance: [
				{ kind: "venue_dataset", label: `PUBMAXX venue record for ${venue.name}` },
				{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
				...tonightEvents.map((event) => ({ kind: "night_signal" as const, label: `${event.source.label}: ${event.title}`, asOf: event.observedAt })),
				...signalClaims.map((signal) => ({ kind: "night_signal" as const, label: `${signal.publisher}: ${signal.claim}`, asOf: signal.observedAt })),
				...(planningWeather ? [{
					kind: "night_signal" as const,
					label: `${planningWeather.source.publisher}: ${planningWeather.condition}`,
					asOf: planningWeather.observedAt,
				}] : []),
			],
	      reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${reasons.length ? `, ${reasons.slice(0, 2).join(", ")}` : ""}.`,
	      alternatives: candidates
				.filter(({ venue: alternative }) => !chosen.some(({ venue: selected }) => selected.id === alternative.id))
				.map(({ venue: alternative }) => ({
					venueId: alternative.id,
					venueName: alternative.name,
					distanceKm: Number(distanceKm(venue, alternative).toFixed(2)),
					estimatedPintPricePence: alternative.cheapestPrice === null ? null : Math.round(alternative.cheapestPrice * 100),
					provenance: [{ kind: "venue_dataset", label: `PUBMAXX venue record for ${alternative.name}` }],
				}))
				.sort((left, right) => left.distanceKm - right.distanceKm)
				.slice(0, 2),
	    })),
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
