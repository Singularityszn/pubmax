// Request-time Skiddle Events seam for /api/out.
// Reads SKIDDLE_API_KEY at call time. Absent key = not-configured, never
// an empty-market claim. Never logs the key.

import { normaliseSkiddleEvents } from "../../scripts/whatson/eventsRefresh.mjs";
import type { EventsProvider, EventsProviderContext } from "@/lib/events/provider";
import { londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const LONDON = { lat: 51.5074, lng: -0.1278, radiusMiles: 30 };

function readKey(): string | undefined {
  const value = process.env.SKIDDLE_API_KEY;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

type CacheEntry = { at: number; windowStart: string; rows: WhatsOnRow[] };
let cache: CacheEntry | null = null;

export function resetSkiddleCache(): void {
  cache = null;
}

export function isSkiddleConfigured(): boolean {
  return readKey() !== undefined;
}

export async function fetchSkiddleTonightRows(
  ctx: EventsProviderContext,
): Promise<WhatsOnRow[]> {
  const key = readKey();
  if (!key) return [];

  const { start, end } = londonServiceDayBounds(ctx.now);
  if (cache && cache.windowStart === start && ctx.now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }

  const fetchImpl = ctx.fetchImpl ?? fetch;
  const url = new URL("https://www.skiddle.com/api/v1/events/search/");
  url.search = new URLSearchParams({
    api_key: key,
    latitude: String(LONDON.lat),
    longitude: String(LONDON.lng),
    radius: String(LONDON.radiusMiles),
    eventcode: "LIVE,FEST,SPORT,CLUB,COMEDY,THEATRE,BARPUB",
    minDate: start.slice(0, 10),
    maxDate: end.slice(0, 10),
    order: "date",
    limit: "100",
    description: "1",
  }).toString();

  const res = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "PUBMAXX-out/1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Skiddle Events API returned ${res.status}`);
  }
  const payload = await res.json();
  const observedAt = new Date(ctx.now).toISOString();
  const { rows } = normaliseSkiddleEvents(payload, { observedAt });
  cache = { at: ctx.now, windowStart: start, rows };
  return rows;
}

export function createSkiddleProvider(): EventsProvider {
  return {
    name: "skiddle",
    isConfigured: () => isSkiddleConfigured(),
    fetchTonight: (ctx) => fetchSkiddleTonightRows(ctx),
  };
}
