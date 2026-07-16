import { jsonNoStore } from "@/lib/apiResponses";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
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
import type { PublicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

let baselineWhatsOn: WhatsOnRow[] | null = null;

function baselineTonight(now: number): WhatsOnRow[] {
  baselineWhatsOn ??= loadBaselineWhatsOn();
  return filterTonight(baselineWhatsOn, now);
}

function publicError(error: string, code: string, retryable = false, details?: Record<string, unknown>): PublicApiError {
  return { error, code, retryable, ...(details ? { details } : {}) };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const latKm = (a.lat - b.lat) * 111;
  const lngKm = (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(latKm, lngKm);
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
		score += 2;
		reasons.push("beer garden on record; weather still needs checking");
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

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore(publicError("Malformed request body.", "MALFORMED_REQUEST"), { status: 400 }); }
  if (await isLimited(`plan-generate:${hashIp(clientIp(request))}`, "plan-generate")) return jsonNoStore(publicError("Too many requests.", "RATE_LIMITED", true), { status: 429 });
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query && !body.context) return jsonNoStore(publicError("Describe the night or provide Night Context.", "NIGHT_CONTEXT_REQUIRED"), { status: 400 });
  const inferred = inferNightContext(query);
  const context = mergeContext(inferred.context, body.context);
  if (!context.nightArea) return jsonNoStore(publicError("Choose a Night Area.", "NIGHT_AREA_REQUIRED"), { status: 422 });
  const cityId = typeof body.cityId === "string" ? parseCityId(body.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return jsonNoStore(publicError("cityId is invalid.", "CITY_INVALID"), { status: 400 });
  const area = getNightArea(context.nightArea);
  if (area.cityId !== cityId) return jsonNoStore(publicError("The selected Night Area is not available in this city.", "NIGHT_AREA_CITY_MISMATCH"), { status: 422 });
	const routeReady = isNightAreaRouteReady(area);
	const coverage = publicNightAreaCoverage(area);
	const requestNow = Date.now();
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
	      const scored = scoreVenueForContext(venue, context, distance, tonightEvents, signalClaims);
	      return { venue, distance, tonightEvents, signalClaims, ...scored };
	    })
    .filter(({ distance }) => distance <= area.radiusKm)
    .sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 3);
  if (chosen.length < 3) return jsonNoStore(publicError(`Not enough grounded venues are available in ${area.name} yet.`, "GROUNDED_VENUES_INSUFFICIENT", false, { nightArea: area.slug, availableVenueCount: chosen.length }), { status: 422 });
	const contextEvidenceGaps = missingContextEvidence(context);
	const operationalEvidenceGaps = ["current_opening_hours"];
	if ((context.groupSize ?? 1) > 1) operationalEvidenceGaps.push("get_in_estimates");
	if (
		context.atmosphere.some((value) => ["lively", "music", "sports"].includes(value)) &&
		chosen.every(({ tonightEvents }) => tonightEvents.length === 0)
	) operationalEvidenceGaps.push("tonight_event_evidence");
	if (context.atmosphere.includes("garden")) operationalEvidenceGaps.push("live_weather");
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
	const lateFood = lateFoodArea ? getLateFoodForArea(lateFoodArea) : [];
	const rankedLateFood = context.foodNeeds.length === 0 ? lateFood : [...lateFood].sort((left, right) => {
		const leftMatch = context.foodNeeds.some((need) => left.category === need || left.dietary.some((tag) => tag === need));
		const rightMatch = context.foodNeeds.some((need) => right.category === need || right.dietary.some((tag) => tag === need));
		return Number(rightMatch) - Number(leftMatch);
	});
	const endingRecommendations = buildPlanEndingRecommendations({
		daypart: context.daypart,
		foodRequested: context.foodNeeds.length > 0,
		transportAnchor: area.transportAnchors[0] ?? area.name,
		lateFood: rankedLateFood,
		extensions,
	});
	const nightArea = { id: area.slug, ...coverage };
  return jsonNoStore({
    inferredContext: context,
    confidence: inferred.confidence,
		planningConfidence,
		budgetSummary,
		routeTotals,
		endingRecommendations,
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
	    ],
	    missingContextEvidence: contextEvidenceGaps,
	    relevantSignals: area.recentSignals,
		nightSignalClaims: reviewedSignalClaims.filter((claim) =>
			(claim.entity.type === "night_area" && claim.entity.id === area.slug) ||
			chosen.some(({ venue }) => claim.entity.type === "venue" && claim.entity.id === venue.id),
		),
	  });
}
