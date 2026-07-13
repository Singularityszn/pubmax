import { jsonNoStore } from "@/lib/apiResponses";
import { DEFAULT_CITY_ID, parseCityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { getNightArea } from "@/lib/nightAreas";
import { cleanNightContext, inferNightContext, isNightAreaSlug, type NightContext } from "@/lib/nightPlanning";
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
    ...(typeof value.daypart === "string" && ["daytime", "after_work", "evening", "late_night", "get_home"].includes(value.daypart) ? { daypart: value.daypart as NightContext["daypart"] } : {}),
    ...(typeof value.groupSize === "number" && value.groupSize >= 1 && value.groupSize <= 30 ? { groupSize: Math.floor(value.groupSize) } : {}),
    ...(["solo", "friends", "work"].includes(value.partyType ?? "") ? { partyType: value.partyType } : {}),
    ...(["value", "standard", "treat"].includes(value.budget ?? "") ? { budget: value.budget } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }
  if (await isLimited(`plan-generate:${hashIp(clientIp(request))}`, "plan-generate")) return jsonNoStore({ error: "Too many requests." }, { status: 429 });
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query && !body.context) return jsonNoStore({ error: "Describe the night or provide Night Context." }, { status: 400 });
  const inferred = inferNightContext(query);
  const context = mergeContext(inferred.context, body.context);
  if (!context.nightArea) return jsonNoStore({ error: "Choose one of the six pilot Night Areas." }, { status: 422 });
  const cityId = typeof body.cityId === "string" ? parseCityId(body.cityId) : DEFAULT_CITY_ID;
  if (!cityId) return jsonNoStore({ error: "cityId is invalid." }, { status: 400 });
  const area = getNightArea(context.nightArea);
  const candidates = (await loadConciergeVenues(cityId))
    .map((venue) => {
      const distance = distanceKm(area.centre, venue);
      const price = venue.cheapestPrice ?? 7;
      const valueBoost = context.budget === "value" ? Math.max(0, 7 - price) : 0;
      const atmosphereBoost = context.atmosphere.includes("historic") && venue.hasStory ? 2 : 0;
      return { venue, distance, score: valueBoost + atmosphereBoost - distance * 2 };
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
      reason: `${distance < 0.5 ? "Close to the heart of the area" : `${distance.toFixed(1)} km from the area centre`}${context.budget === "value" && venue.cheapestPrice ? ` · pints from £${venue.cheapestPrice.toFixed(2)}` : ""}.`,
      alternatives: candidates.slice(3, 5).map(({ venue: alternative }) => ({ venueId: alternative.id, venueName: alternative.name })),
    })),
    relevantSignals: area.recentSignals,
  });
}
