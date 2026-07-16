import { jsonNoStore } from "@/lib/apiResponses";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
import { cleanNightContext, cleanNightContextPatch, inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { PlanBudgetSummary, PlanningConfidence } from "@/lib/planIntelligence";
import type { PublicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

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
	  const candidates = (await loadConciergeVenues(cityId))
	    .map((venue) => {
	      const distance = distanceKm(area.centre, venue);
	      const scored = scoreVenueForContext(venue, context, distance);
	      return { venue, distance, ...scored };
	    })
    .filter(({ distance }) => distance <= area.radiusKm)
    .sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 3);
  if (chosen.length < 3) return jsonNoStore(publicError(`Not enough grounded venues are available in ${area.name} yet.`, "GROUNDED_VENUES_INSUFFICIENT", false, { nightArea: area.slug, availableVenueCount: chosen.length }), { status: 422 });
	const contextEvidenceGaps = missingContextEvidence(context);
	if (context.budgetLimitPence && chosen.some(({ venue }) => venue.cheapestPrice === null)) {
		contextEvidenceGaps.push("price_evidence");
	}
	if (context.zeroProof && chosen.every(({ venue }) => venue.amenities.nonAlcoholic === true)) {
		const zeroProofGap = contextEvidenceGaps.indexOf("zero_proof_options");
		if (zeroProofGap >= 0) contextEvidenceGaps.splice(zeroProofGap, 1);
	}
	const missingEvidence = [...new Set([...area.missingEvidence, ...contextEvidenceGaps])];
	const confidenceScore = Math.max(0, Math.min(1, Math.min(inferred.confidence, coverage.coverageScore / 100)));
	const planningConfidence: PlanningConfidence = {
		level: routeReady ? (contextEvidenceGaps.length ? "medium" : "high") : "low",
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
	const nightArea = { id: area.slug, ...coverage };
  return jsonNoStore({
    inferredContext: context,
    confidence: inferred.confidence,
		planningConfidence,
		budgetSummary,
		nightArea,
		// Back-compatible alias until every client has moved to Night Area.
		district: nightArea,
    explanations: inferred.reasons,
	    stops: chosen.map(({ venue, distance, reasons }, index) => ({
	      venueId: venue.id,
	      venueName: venue.name,
	      position: index,
			distanceKm: Number(distance.toFixed(2)),
			estimatedPintPricePence: venue.cheapestPrice === null ? null : Math.round(venue.cheapestPrice * 100),
			evidence: reasons,
			provenance: [
				{ kind: "venue_dataset", label: `PUBMAXX venue record for ${venue.name}` },
				{ kind: "night_area_review", label: `${area.name} Night Area review`, asOf: area.lastReviewedAt },
			],
	      reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${reasons.length ? `, ${reasons.slice(0, 2).join(", ")}` : ""}.`,
	      alternatives: candidates.slice(3, 5).map(({ venue: alternative }) => ({ venueId: alternative.id, venueName: alternative.name })),
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
	  });
}
