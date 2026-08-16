import rawEventsLondon from "../../public/data/whats_on/events_london.json";
import { EVENT_REFRESH_CITIES } from "../../scripts/whatson/eventsRefresh.mjs";
import type { EventsProvider, EventsProviderReport } from "@/lib/events/provider";
import { createSkiddleProvider } from "@/lib/events/skiddle";
import { createTicketmasterProvider } from "@/lib/events/ticketmaster";
import { fillEventArea } from "@/lib/out/eventArea";
import { outSourceAttribution } from "@/lib/out/attribution";
import { OUT_DAYS, type OutDay, type OutQuery, type OutResponse } from "@/lib/out/types";
import {
  dedupeRows,
  londonServiceDayBounds,
  parseWhatsOnRows,
  rowEffectiveEnd,
  tonightServiceWindow,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const MAX_OUT_EVENTS = 100;
export const OUT_CITIES = EVENT_REFRESH_CITIES;
export type OutCity = (typeof OUT_CITIES)[number];
export type { OutDay, OutQuery, OutResponse } from "@/lib/out/types";
export { OUT_DAYS } from "@/lib/out/types";

export type OutLiveProvider = Pick<EventsProvider, "name" | "isConfigured" | "fetchTonight">;

export type BuildOutResponseOpts = {
  now?: number;
  loadBaseline?: (city: OutCity) => WhatsOnRow[];
  liveProviders?: OutLiveProvider[];
};

function isOutCity(value: string): value is OutCity {
  return (OUT_CITIES as readonly string[]).includes(value);
}

function isOutDay(value: string): value is OutDay {
  return (OUT_DAYS as readonly string[]).includes(value);
}

export function parseOutQuery(params: URLSearchParams): OutQuery | null {
  const cityRaw = (params.get("city") ?? "london").trim().toLowerCase();
  const dayRaw = (params.get("day") ?? "today").trim().toLowerCase();
  if (!isOutCity(cityRaw) || !isOutDay(dayRaw)) return null;
  return { city: cityRaw, day: dayRaw };
}

function generatedAtOf(raw: unknown): number {
  const at = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(at) ? at : Date.now();
}

export function loadBundledOutEvents(city: OutCity): WhatsOnRow[] {
  if (city !== "london") return [];
  return parseWhatsOnRows(rawEventsLondon, generatedAtOf(rawEventsLondon));
}

export function outDayWindow(day: OutDay, now: number): { startMs: number; endMs: number } {
  if (day === "today") return tonightServiceWindow(now);
  if (day === "tomorrow") {
    const today = londonServiceDayBounds(now);
    return tonightServiceWindow(Date.parse(today.end) + 1);
  }
  const today = tonightServiceWindow(now);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const weekdayIndex: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 0,
  };
  const current = weekdayIndex[weekday] ?? 1;
  const inThisWeekend =
    current === 6 || current === 0 || (current === 5 && hour >= 16) || (current === 1 && hour < 4);
  const daysUntilFriday = inThisWeekend
    ? current === 6
      ? -1
      : current === 0
        ? -2
        : current === 1
          ? -3
          : 0
    : (5 - current + 7) % 7;
  const fridayStart = today.startMs + daysUntilFriday * 24 * 60 * 60 * 1000;
  return { startMs: fridayStart, endMs: fridayStart + 3 * 24 * 60 * 60 * 1000 };
}

function rowOverlapsWindow(row: WhatsOnRow, window: { startMs: number; endMs: number }): boolean {
  if (!row.startsAt) {
    if (row.listedWindow === "tonight") return true;
    if (row.listedWindow === "tomorrow_night") return true;
    if (row.listedWindow === "this_weekend") return true;
    return false;
  }
  const start = Date.parse(row.startsAt);
  if (!Number.isFinite(start)) return false;
  const end = rowEffectiveEnd(row);
  return start < window.endMs && end > window.startMs;
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

export async function buildOutResponse(
  query: OutQuery,
  opts: BuildOutResponseOpts = {},
): Promise<OutResponse> {
  const now = opts.now ?? Date.now();
  const loadBaseline = opts.loadBaseline ?? loadBundledOutEvents;
  const liveProviders = opts.liveProviders ?? [
    createTicketmasterProvider(),
    createSkiddleProvider(),
  ];

  let status: "ready" | "degraded" = "ready";
  let baseline: WhatsOnRow[] = [];
  try {
    baseline = loadBaseline(query.city);
  } catch {
    status = "degraded";
    baseline = [];
  }

  const reports: EventsProviderReport[] = [];
  const liveRows: WhatsOnRow[] = [];
  for (const provider of liveProviders) {
    if (!provider.isConfigured()) {
      reports.push({ name: provider.name, configured: false, rows: 0 });
      continue;
    }
    try {
      const rows = await provider.fetchTonight({ now });
      liveRows.push(...rows);
      reports.push({ name: provider.name, configured: true, rows: rows.length });
    } catch (err) {
      status = "degraded";
      reports.push({
        name: provider.name,
        configured: true,
        rows: 0,
        error: err instanceof Error ? err.message : "provider failed",
      });
    }
  }

  const window = outDayWindow(query.day, now);
  const merged = dedupeRows([...baseline, ...liveRows])
    .filter((row) => rowOverlapsWindow(row, window))
    .map(fillEventArea)
    .sort(
      (left, right) =>
        (left.startsAt ?? "").localeCompare(right.startsAt ?? "") || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_OUT_EVENTS);

  reports.sort((left, right) => left.name.localeCompare(right.name));

  return {
    status,
    events: merged,
    openPlans: [],
    attribution: outSourceAttribution(merged),
    observedAt: observedAtBySource(merged),
    providers: reports,
  };
}
