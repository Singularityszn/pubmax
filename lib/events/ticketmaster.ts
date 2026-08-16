// Request-time Ticketmaster Discovery seam for /api/out.
// Reads TICKETMASTER_API_KEY at call time. Never logs the key.

import { normaliseTicketmasterEvents } from "../../scripts/whatson/eventsRefresh.mjs";
import type { EventsProvider, EventsProviderContext } from "@/lib/events/provider";
import { londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

function readKey(): string | undefined {
  const value = process.env.TICKETMASTER_API_KEY;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

type CacheEntry = { at: number; windowStart: string; rows: WhatsOnRow[] };
let cache: CacheEntry | null = null;

export function resetTicketmasterCache(): void {
  cache = null;
}

export function isTicketmasterConfigured(): boolean {
  return readKey() !== undefined;
}

function toTmInstant(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export async function fetchTicketmasterTonightRows(
  ctx: EventsProviderContext,
): Promise<WhatsOnRow[]> {
  const key = readKey();
  if (!key) return [];

  const { start, end } = londonServiceDayBounds(ctx.now);
  if (cache && cache.windowStart === start && ctx.now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }

  const fetchImpl = ctx.fetchImpl ?? fetch;
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.search = new URLSearchParams({
    apikey: key,
    countryCode: "GB",
    latlong: "51.5074,-0.1278",
    radius: "30",
    unit: "miles",
    startDateTime: toTmInstant(start),
    endDateTime: toTmInstant(end),
    size: "100",
    sort: "date,asc",
  }).toString();

  const res = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "PUBMAXX-out/1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Ticketmaster Discovery API returned ${res.status}`);
  }
  const payload = await res.json();
  const observedAt = new Date(ctx.now).toISOString();
  const { rows } = normaliseTicketmasterEvents(payload, { observedAt });
  cache = { at: ctx.now, windowStart: start, rows };
  return rows;
}

export function createTicketmasterProvider(): EventsProvider {
  return {
    name: "ticketmaster",
    isConfigured: () => isTicketmasterConfigured(),
    fetchTonight: (ctx) => fetchTicketmasterTonightRows(ctx),
  };
}


