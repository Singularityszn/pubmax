import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import {
  CONCIERGE_MOODS,
  narrateCrawl,
  rankConciergeVenues,
  type ConciergeContext,
  type ConciergeIntent,
  type ConciergeMood,
} from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

if (process.env.NODE_ENV === "production") assertProductionSecrets();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_QUERY_LENGTH = 500;

function providedIntent(value: unknown): ConciergeIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.mood) || !record.mood.every((item) => typeof item === "string" && CONCIERGE_MOODS.includes(item as ConciergeMood))) return null;
  if (typeof record.groupSize !== "number" || !Number.isInteger(record.groupSize) || record.groupSize < 1 || record.groupSize > 20) return null;
  if (record.area !== undefined && (typeof record.area !== "string" || !record.area.trim() || record.area.length > 80)) return null;
  if (record.maxPintPrice !== undefined && (typeof record.maxPintPrice !== "number" || !Number.isFinite(record.maxPintPrice) || record.maxPintPrice < 3 || record.maxPintPrice > 15)) return null;
  return {
    mood: [...new Set(record.mood as ConciergeMood[])],
    groupSize: record.groupSize,
    ...(typeof record.area === "string" ? { area: record.area.trim() } : {}),
    ...(typeof record.maxPintPrice === "number" ? { maxPintPrice: record.maxPintPrice } : {}),
  };
}

export function contextFrom(value: unknown, now = new Date()): ConciergeContext {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 12);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const weather = ["rainy", "cold", "warm-dry", "mild"].includes(String(record.weather))
    ? record.weather as ConciergeContext["weather"]
    : undefined;
  return {
    ...(weather ? { weather } : {}),
    dayType: record.dayType === "weekday" || record.dayType === "weekend"
      ? record.dayType
      : weekday === "Sat" || weekday === "Sun" ? "weekend" : "weekday",
    timeOfDay: record.timeOfDay === "afternoon" || record.timeOfDay === "evening" || record.timeOfDay === "late"
      ? record.timeOfDay
      : hour >= 22 || hour < 5 ? "late" : hour < 17 ? "afternoon" : "evening",
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "Malformed JSON." }, { status: 400 });
  }

  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const query = typeof record.query === "string" ? record.query.trim().slice(0, MAX_QUERY_LENGTH) : "";
  const directIntent = record.intent === undefined ? null : providedIntent(record.intent);
  if (!query && !directIntent) {
    return jsonNoStore({ error: record.intent === undefined ? "query or intent is required." : "intent is invalid." }, { status: 400 });
  }

  const rawCity = typeof record.cityId === "string" ? record.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return jsonNoStore({ error: "cityId is invalid." }, { status: 400 });

  const limiterKey = `concierge:${hashIp(clientIp(request))}`;
  // Fail CLOSED: concierge calls a paid LLM. If the durable limiter can't
  // answer (Supabase misconfig/outage), refuse rather than fall back to a
  // scriptable per-instance budget (B2).
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true })) {
    return jsonNoStore({ error: "Too many concierge requests, slow down." }, { status: 429 });
  }

  // Paid-spend guard (cursor bot, PR #149): without Supabase, isLimited() can
  // only offer a per-instance in-memory budget — scriptable across lambdas. In
  // that state the PAID model assist is withheld in production (deterministic
  // parse still answers, so the route degrades honestly instead of 429ing).
  // Dev/tests keep the assist; with Supabase the durable limiter governs.
  const llmAssistAllowed =
    isSupabaseConfigured() || process.env.NODE_ENV !== "production";

  try {
    const parsed = directIntent
      ? { intent: directIntent, source: "provided" as const }
      : await parseConciergeIntent(query, { skipModel: !llmAssistAllowed });
    const venues = await loadConciergeVenues(cityId);
    const ranked = rankConciergeVenues(venues, parsed.intent, {
      limit: typeof record.limit === "number" ? record.limit : 3,
      context: contextFrom(record.context),
    });
    const results = ranked.map(({ venue, score, reasons }) => ({
      id: venue.id,
      name: venue.name,
      area: venue.area,
      lat: venue.lat,
      lng: venue.lng,
      cheapestPrice: venue.cheapestPrice,
      score,
      reasons,
    }));
    return jsonNoStore({
      intent: parsed.intent,
      intentSource: parsed.source,
      venues: results,
      ...(record.narrated === true ? { narration: narrateCrawl(ranked) ?? null } : {}),
    });
  } catch {
    // The demo remains useful without keys or upstream services; if even the
    // local dataset is unavailable, state the empty result rather than inventing.
    return jsonNoStore({
      intent: directIntent ?? { mood: [], groupSize: 2 },
      intentSource: directIntent ? "provided" : "deterministic",
      venues: [],
      message: "I couldn't load grounded venue options just now, so I won't make any up.",
    });
  }
}
