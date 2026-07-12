import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { contextFrom } from "@/lib/concierge/context";
import {
  CONCIERGE_MOODS,
  narrateCrawl,
  rankConciergeVenues,
  type ConciergeIntent,
  type ConciergeMood,
} from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  buildWhatsOnAnswer,
  detectWhatsOnIntent,
  filterRowsByArea,
  filterRowsByWeekday,
} from "@/lib/concierge/whatsOn";
import { loadWhatsOn } from "@/lib/whatsOnStore";
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

  // What's-On intents (W5 / B7): a "quiz tonight / what's on in Soho / where's
  // showing the football / curry club deals" query is answered from real
  // What's-On store rows — grounded, with provenance, refusing honestly when no
  // rows match. Only free-text queries route here; a tap-chip mood intent stays
  // on the venue-ranking path. Runs no paid model.
  const whatsOnQuery = query ? detectWhatsOnIntent(query) : null;
  if (whatsOnQuery) {
    try {
      const { rows, asOf } = await loadWhatsOn(
        {
          ...(whatsOnQuery.kind ? { kind: whatsOnQuery.kind } : {}),
          ...(whatsOnQuery.window === "tonight" ? { window: "tonight" as const } : {}),
        },
        {},
      );
      let matched = whatsOnQuery.area ? filterRowsByArea(rows, whatsOnQuery.area) : rows;
      if (whatsOnQuery.window === "weekday" && whatsOnQuery.weekday !== undefined) {
        matched = filterRowsByWeekday(matched, whatsOnQuery.weekday);
      }
      const answer = buildWhatsOnAnswer(whatsOnQuery, matched);
      return jsonNoStore({ ...answer, asOf });
    } catch {
      // Even the grounding source is unavailable — refuse rather than invent.
      return jsonNoStore({
        mode: "whats-on",
        kind: whatsOnQuery.kind ?? null,
        window: whatsOnQuery.window ?? null,
        area: whatsOnQuery.area ?? null,
        count: 0,
        listings: [],
        message: "I couldn't load the verified What's-On data just now, so I won't make anything up.",
      });
    }
  }

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
