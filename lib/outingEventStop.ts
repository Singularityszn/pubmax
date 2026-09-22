import type { WhatsOnRow } from "@/lib/whatsOn";

/** A published event is a sourced itinerary stop, never a pub venue. */
export type OutingEventStop = {
  kind: "event";
  id: string;
  title: string;
  placeName?: string;
  venueId?: string;
  source: { label: string; url: string };
  startsAt?: string;
  startsDate?: string;
  endsAt?: string;
  observedAt?: string;
  admissionGbp: number | null;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day
    ? value
    : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function safeSourceUrl(value: unknown): string | null {
  const raw = text(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function cleanOutingEventStop(value: unknown): OutingEventStop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const source = row.source && typeof row.source === "object" && !Array.isArray(row.source)
    ? row.source as Record<string, unknown>
    : null;
  const id = text(row.id, 120);
  const title = text(row.title, 200);
  const label = text(source?.label, 120);
  const url = safeSourceUrl(source?.url);
  const admissionGbp = row.admissionGbp;
  if (
    row.kind !== "event" || !id || !title || !label || !url ||
    (admissionGbp !== null && (typeof admissionGbp !== "number" || !Number.isFinite(admissionGbp) || admissionGbp < 0))
  ) return null;
  const startsAt = row.startsAt === undefined ? null : instant(row.startsAt);
  const startsDate = row.startsDate === undefined ? null : calendarDate(row.startsDate);
  const endsAt = row.endsAt === undefined ? null : instant(row.endsAt);
  const observedAt = row.observedAt === undefined ? null : instant(row.observedAt);
  if (
    (row.startsAt !== undefined && !startsAt) ||
    (row.startsDate !== undefined && !startsDate) ||
    (row.endsAt !== undefined && !endsAt) ||
    (row.observedAt !== undefined && !observedAt)
  ) return null;
  const placeName = text(row.placeName, 200);
  const venueId = text(row.venueId, 80);
  return {
    kind: "event",
    id,
    title,
    ...(placeName ? { placeName } : {}),
    ...(venueId ? { venueId } : {}),
    source: { label, url },
    ...(startsAt ? { startsAt } : {}),
    ...(startsDate ? { startsDate } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(observedAt ? { observedAt } : {}),
    admissionGbp: admissionGbp as number | null,
  };
}

export function outingEventStopFromRow(row: WhatsOnRow): OutingEventStop | null {
  return cleanOutingEventStop({
    kind: "event",
    id: row.id,
    title: row.title,
    placeName: row.placeName,
    venueId: row.venueId,
    source: row.source,
    startsAt: row.startsAt,
    startsDate: row.startsDate,
    endsAt: row.endsAt,
    observedAt: row.observedAt,
    admissionGbp: typeof row.priceGbp === "number" ? row.priceGbp : null,
  });
}

export type OrderedOutingStop<T> =
  | { kind: "pub"; stop: T }
  | { kind: "event"; event: OutingEventStop };

/** Interleave one sourced non-pub stop without mutating the pub crawl order. */
export function orderOutingStops<T>(
  pubs: readonly T[],
  eventStop: OutingEventStop | null,
  eventPosition: number | null,
): OrderedOutingStop<T>[] {
  const position = eventStop && eventPosition !== null && Number.isInteger(eventPosition)
    ? Math.min(pubs.length, Math.max(0, eventPosition))
    : eventStop ? 0 : null;
  const ordered: OrderedOutingStop<T>[] = [];
  for (let index = 0; index <= pubs.length; index += 1) {
    if (eventStop && position === index) ordered.push({ kind: "event", event: eventStop });
    const stop = pubs[index];
    if (stop !== undefined) ordered.push({ kind: "pub", stop });
  }
  return ordered;
}
