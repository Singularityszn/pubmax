import rawEventsLondon from "../../public/data/whats_on/events_london.json";
import { EVENT_REFRESH_CITIES } from "../../scripts/whatson/eventsRefresh.mjs";
import { CITIES, type CityId } from "@/lib/cities";
import type { EventsProvider } from "@/lib/events/provider";
import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { log } from "@/lib/log";
import { fillEventArea } from "@/lib/out/eventArea";
import { outSourceAttribution } from "@/lib/out/attribution";
import {
  MAX_OUT_EVENTS,
  OUT_DAYS,
  type OutDay,
  type OutProviderReport,
  type OutQuery,
  type OutResponse,
} from "@/lib/out/types";
import {
  bundledGeneratedAt,
  londonServiceDayBounds,
  dedupeRows,
  parseWhatsOnRows,
  rowStatedInterval,
  tonightServiceWindow,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const OUT_CITIES = EVENT_REFRESH_CITIES;
export type OutCity = (typeof OUT_CITIES)[number];
export type { OutDay, OutQuery, OutResponse } from "@/lib/out/types";
export { MAX_OUT_EVENTS, OUT_DAYS } from "@/lib/out/types";

export type OutLiveProvider = Pick<EventsProvider, "name" | "isConfigured" | "fetchTonight">;

export type BuildOutResponseOpts = {
  now?: number;
  loadBaseline?: (city: OutCity) => WhatsOnRow[];
  liveProviders?: OutLiveProvider[];
};

// A city is COVERED when a bundled events file for it ships. The param is open
// to every refresh city so turning one on is data (run the refresh, commit the
// file, add it here), but until that file exists the answer is an honest
// "not covered yet" with zero rows. It may never be another city's listings:
// serving London under a Bristol query is worse than saying nothing.
const BUNDLED_EVENT_FILES: Partial<Record<OutCity, unknown>> = {
  london: rawEventsLondon,
};

function isOutCity(value: string): value is OutCity {
  return (OUT_CITIES as readonly string[]).includes(value);
}

function isOutDay(value: string): value is OutDay {
  return (OUT_DAYS as readonly string[]).includes(value);
}

export function isOutCityCovered(city: OutCity): boolean {
  return BUNDLED_EVENT_FILES[city] !== undefined;
}

function cityDisplayName(city: OutCity): string {
  return CITIES[city as CityId]?.displayName ?? city;
}

export function outCityNotCoveredReason(city: OutCity): string {
  return `Out does not cover ${cityDisplayName(city)} yet.`;
}

export function parseOutQuery(params: URLSearchParams): OutQuery | null {
  const cityRaw = (params.get("city") ?? "london").trim().toLowerCase();
  const dayRaw = (params.get("day") ?? "today").trim().toLowerCase();
  if (!isOutCity(cityRaw) || !isOutDay(dayRaw)) return null;
  return { city: cityRaw, day: dayRaw };
}

export function loadBundledOutEvents(city: OutCity): WhatsOnRow[] {
  const raw = BUNDLED_EVENT_FILES[city];
  if (raw === undefined) return [];
  return parseWhatsOnRows(raw, bundledGeneratedAt(raw));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Which weekday the SERVICE day belongs to. Reading the weekday off `now`
// instead mixes two day origins: at Sunday 02:00 London the service day is
// still Saturday's evening, so `now` says Sun and the weekend window landed a
// day early - with Sunday night outside `day=weekend` entirely.
function serviceDayWeekdayIndex(serviceDayStartMs: number): number {
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(new Date(serviceDayStartMs));
  const index: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return index[weekday] ?? 1;
}

export function outDayWindow(day: OutDay, now: number): { startMs: number; endMs: number } {
  if (day === "today") return tonightServiceWindow(now);
  if (day === "tomorrow") {
    const today = londonServiceDayBounds(now);
    return tonightServiceWindow(Date.parse(today.end) + 1);
  }
  const today = tonightServiceWindow(now);
  const current = serviceDayWeekdayIndex(today.startMs);
  // Friday, Saturday and Sunday evenings are THIS weekend; anything else looks
  // forward to the next Friday.
  const daysUntilFriday =
    current === 5 ? 0 : current === 6 ? -1 : current === 0 ? -2 : (5 - current + 7) % 7;
  const fridayStart = today.startMs + daysUntilFriday * DAY_MS;
  return { startMs: fridayStart, endMs: fridayStart + 3 * DAY_MS };
}

function rowOverlapsWindow(row: WhatsOnRow, window: { startMs: number; endMs: number }): boolean {
  const stated = rowStatedInterval(row);
  if (stated) {
    if (!Number.isFinite(stated.startMs) || !Number.isFinite(stated.endMs)) return false;
    return stated.startMs < window.endMs && stated.endMs > window.startMs;
  }
  if (row.listedWindow === "tonight") return true;
  if (row.listedWindow === "tomorrow_night") return true;
  if (row.listedWindow === "this_weekend") return true;
  return false;
}

function observedAtBySource(rows: readonly WhatsOnRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.source.label.toLowerCase();
    const current = out[key];
    if (!current || Date.parse(row.observedAt) > Date.parse(current)) {
      out[key] = row.observedAt;
    }
  }
  return out;
}

function notCoveredResponse(city: OutCity): OutResponse {
  return {
    status: "degraded",
    events: [],
    openPlans: [],
    attribution: [],
    observedAt: {},
    providers: [],
    reason: outCityNotCoveredReason(city),
  };
}

export async function buildOutResponse(
  query: OutQuery,
  opts: BuildOutResponseOpts = {},
): Promise<OutResponse> {
  const now = opts.now ?? Date.now();
  const city = query.city as OutCity;
  if (!isOutCityCovered(city)) return notCoveredResponse(city);

  const loadBaseline = opts.loadBaseline ?? loadBundledOutEvents;
  const liveProviders = opts.liveProviders ?? [
    createTicketmasterProvider(),
    createSkiddleProvider(),
  ];

  let status: "ready" | "degraded" = "ready";
  let reason: string | undefined;
  let baseline: WhatsOnRow[] = [];
  try {
    baseline = loadBaseline(city);
  } catch {
    status = "degraded";
    reason = "Some listings could not be checked.";
    baseline = [];
  }

  const window = outDayWindow(query.day, now);

  const reports: OutProviderReport[] = [];
  const liveRows: WhatsOnRow[] = [];
  for (const provider of liveProviders) {
    if (!provider.isConfigured()) {
      reports.push({
        name: provider.name,
        configured: false,
        rows: 0,
        status: "not-configured",
      });
      continue;
    }
    try {
      // The provider is asked for the window this answer will KEEP, so a
      // tomorrow or weekend request never spends an upstream call on rows the
      // filter below would discard.
      const rows = await provider.fetchTonight({ now, city, window });
      liveRows.push(...rows);
      reports.push({ name: provider.name, configured: true, rows: rows.length, status: "ready" });
    } catch (err) {
      status = "degraded";
      reason = "Some listings could not be checked.";
      // The upstream message is a server-side diagnostic. The public body says
      // only that this lane is degraded.
      log("warn", "out.provider_failed", {
        provider: provider.name,
        city,
        day: query.day,
        error: err instanceof Error ? err.message : "provider failed",
      });
      reports.push({ name: provider.name, configured: true, rows: 0, status: "degraded" });
    }
  }

  const merged = dedupeRows([...baseline, ...liveRows])
    .filter((row) => rowOverlapsWindow(row, window))
    .map(fillEventArea)
    .sort(
      (left, right) =>
        (left.startsAt ?? left.startsDate ?? "").localeCompare(
          right.startsAt ?? right.startsDate ?? "",
        ) || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_OUT_EVENTS);

  reports.sort((left, right) => left.name.localeCompare(right.name));

  const body: OutResponse = {
    status,
    events: merged,
    openPlans: [],
    attribution: outSourceAttribution(merged),
    observedAt: observedAtBySource(merged),
    providers: reports,
  };
  if (reason) body.reason = reason;
  return body;
}
