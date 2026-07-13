import { jsonNoStore } from "@/lib/apiResponses";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea, isNightAreaRouteReady, publicNightAreaCoverage } from "@/lib/nightAreas";
import { cleanNightContext, inferNightContext, isBudget, isDaypart, isNightAreaSlug, isPartyType, type NightContext } from "@/lib/nightPlanning";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const latKm = (a.lat - b.lat) * 111;
  const lngKm = (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(latKm, lngKm);
}

function mergeContext(inferred: NightContext, raw: unknown): NightContext {
  const complete = cleanNightContext(raw);
  if (complete) return complete;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return inferred;
  const value = raw as Partial<NightContext>;
	return {
		...inferred,
		...(isNightAreaSlug(value.nightArea) ? { nightArea: value.nightArea } : {}),
		...(isDaypart(value.daypart) ? { daypart: value.daypart } : {}),
		...(typeof value.groupSize === "number" && value.groupSize >= 1 && value.groupSize <= 30 ? { groupSize: Math.floor(value.groupSize) } : {}),
		...(isPartyType(value.partyType) ? { partyType: value.partyType } : {}),
		...(isBudget(value.budget) ? { budget: value.budget } : {}),
	};
}

function scoreVenueForContext(
	venue: Awaited<ReturnType<typeof loadConciergeVenues>>[number],
	context: NightContext,
	distance: number,
): { score: number; reasons: string[] } {
	const reasons: string[] = [];
	const price = venue.cheapestPrice ?? 7;
	let score = -distance * (context.daypart === "late_night" || context.daypart === "get_home" ? 3 : 2);

	if (context.budget === "value") {
		const boost = Math.max(0, 7 - price);
		score += boost;
		if (venue.cheapestPrice) reasons.push(`pints from £${venue.cheapestPrice.toFixed(2)}`);
	} else if (context.budget === "treat" && (venue.amenities.cocktails || venue.hasStory)) {
		score += 1.5;
		reasons.push("fits a treat-night brief");
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

function missingContextEvidence(context: NightContext): string[] {
	const missing = new Set<string>();
	if (context.accessibility.length > 0) missing.add("venue_accessibility");
	if (context.transportConstraints.length > 0) missing.add("per_venue_transport");
	if (context.foodNeeds.some((need) => ["kebab", "halal", "vegan", "vegetarian"].includes(need))) {
		missing.add("food_terminal_specificity");
	}
	return [...missing];
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  if (await isLimited(`plan-generate:${hashIp(clientIp(request))}`, "plan-generate")) return jsonNoStore({ error: "Too many requests." }, { status: 429 });
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query && !body.context) return jsonNoStore({ error: "Describe the night or provide Night Context." }, { status: 400 });
  const inferred = inferNightContext(query);
  const context = mergeContext(inferred.context, body.context);
  if (!context.nightArea) return jsonNoStore({ error: "Choose a Night Area." }, { status: 422 });
  const cityId = typeof body.cityId === "string" ? parseCityId(body.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return jsonNoStore({ error: "cityId is invalid." }, { status: 400 });
  const area = getNightArea(context.nightArea);
  if (area.cityId !== cityId) return jsonNoStore({ error: "The selected Night Area is not available in this city." }, { status: 422 });
  if (!isNightAreaRouteReady(area)) {
    const coverage = publicNightAreaCoverage(area);
    return jsonNoStore({
      error: {
        code: "NIGHT_AREA_ROUTE_NOT_READY",
        message: "We're still checking this Night Area before planning a Crawl Route.",
      },
      nightArea: { id: area.slug, ...coverage },
      // Back-compat for older clients/tests while the product language moves to
      // Night Area. New consumers should read `nightArea`.
      district: { id: area.slug, ...coverage },
    }, { status: 409 });
  }
	  const candidates = (await loadConciergeVenues(cityId))
	    .map((venue) => {
	      const distance = distanceKm(area.centre, venue);
	      const scored = scoreVenueForContext(venue, context, distance);
	      return { venue, distance, ...scored };
	    })
    .filter(({ distance }) => distance <= area.radiusKm)
    .sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 3);
  if (chosen.length < 3) return jsonNoStore({ error: `Not enough grounded venues are available in ${area.name} yet.` }, { status: 422 });
  return jsonNoStore({
    inferredContext: context,
    confidence: inferred.confidence,
    explanations: inferred.reasons,
	    stops: chosen.map(({ venue, distance }, index) => ({
	      venueId: venue.id,
	      venueName: venue.name,
	      position: index,
	      reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${chosen[index].reasons.length ? ` · ${chosen[index].reasons.slice(0, 2).join(" · ")}` : ""}.`,
	      alternatives: candidates.slice(3, 5).map(({ venue: alternative }) => ({ venueId: alternative.id, venueName: alternative.name })),
	    })),
	    contextEffects: [
	      "budget",
	      "daypart",
	      ...(context.groupSize ? ["groupSize"] : []),
	      ...(context.partyType !== "friends" ? ["partyType"] : []),
	      ...(context.atmosphere.length ? ["atmosphere"] : []),
	      ...(context.foodNeeds.length ? ["foodNeeds"] : []),
	    ],
	    missingContextEvidence: missingContextEvidence(context),
	    relevantSignals: area.recentSignals,
	  });
}
