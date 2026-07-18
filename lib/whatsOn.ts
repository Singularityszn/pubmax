// What's-On data spine (Task B1). Types + pure logic for the venue "what's on
// tonight" layer: sport / quiz / deal / music rows, each carrying non-negotiable
// provenance ({label,url}) and a non-future observedAt. zod-free, hand-rolled
// guards mirroring lib/drinkPriceUpdates.ts so a malformed scraped/hand-authored
// row drops instead of poisoning the layer.
//
// Contract note: unlike drink updates, `source` here is { label, url } ONLY —
// no licence field (per the B1 row contract).

import {
  callCityMcpTool,
  type ThingsToDoOpportunity,
  type ThingsToDoResult,
} from "@/lib/citymcp/client";

export const WHATS_ON_KINDS = ["sport", "quiz", "deal", "music"] as const;
export type WhatsOnKind = (typeof WHATS_ON_KINDS)[number];

// "confirmed": venue/organiser directly confirms this row. "listed": a
// first-party listing names this exact row (e.g. a quiz supplier's own venue
// page). "derived": cross-referenced from two separate first-party facts that
// were never jointly confirmed by either source (e.g. "this pub screens live
// sport" x "this fixture kicks off at 8pm") — a plausible, sourced inference,
// not a confirmation. See scripts/whatson/sportFixtures.mjs.
export const WHATS_ON_CONFIDENCES = ["confirmed", "listed", "derived"] as const;
export type WhatsOnConfidence = (typeof WHATS_ON_CONFIDENCES)[number];

// Provenance is non-negotiable: every row is attributable to a real link.
export type WhatsOnSource = { label: string; url: string };

export type WhatsOnRow = {
  id: string;
  venueId?: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: WhatsOnKind;
  startsAt: string; // ISO-8601
  endsAt?: string; // ISO-8601
  title: string;
  detail?: string;
  priceGbp?: number;
  source: WhatsOnSource;
  observedAt: string; // ISO-8601, never in the future
  confidence: WhatsOnConfidence;
};

export function isWhatsOnKind(value: unknown): value is WhatsOnKind {
  return (WHATS_ON_KINDS as readonly string[]).includes(value as string);
}

export function isWhatsOnConfidence(value: unknown): value is WhatsOnConfidence {
  return (WHATS_ON_CONFIDENCES as readonly string[]).includes(value as string);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Optional field: absent (undefined) or null is fine; if present it must be a
// non-empty string. Scraped payloads (e.g. quiz_london.json) use `null` for an
// unresolved venueId, so null is treated as "absent".
function isAbsentOr<T>(value: unknown, guard: (v: unknown) => v is T): boolean {
  return value === undefined || value === null || guard(value);
}

// http(s) URL guard — a source must be a real, absolute link the UI can
// attribute to.
export function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A parseable ISO timestamp (no future constraint — startsAt may be future).
export function isValidIso(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

// A valid ISO timestamp that is not in the future (you cannot have observed an
// event that hasn't happened yet).
export function isValidObservedAt(value: unknown, now: number): value is string {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}

function isValidSource(value: unknown): value is WhatsOnSource {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return isNonEmptyString(s.label) && isHttpUrl(s.url);
}

// Hand-rolled row guard — drop malformed rows rather than throw. `now` is
// injectable for deterministic tests.
export function isValidWhatsOnRow(value: unknown, now: number = Date.now()): value is WhatsOnRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;

  if (!isNonEmptyString(row.id)) return false;
  if (!isNonEmptyString(row.placeName)) return false;
  if (!isWhatsOnKind(row.kind)) return false;
  if (!isValidIso(row.startsAt)) return false;
  if (!isNonEmptyString(row.title)) return false;
  if (!isValidSource(row.source)) return false; // provenance non-negotiable
  if (!isValidObservedAt(row.observedAt, now)) return false; // never future
  if (!isWhatsOnConfidence(row.confidence)) return false;

  if (!isAbsentOr(row.venueId, isNonEmptyString)) return false;
  if (row.lat !== undefined && row.lat !== null && !isFiniteNumber(row.lat)) return false;
  if (row.lng !== undefined && row.lng !== null && !isFiniteNumber(row.lng)) return false;
  if (row.endsAt !== undefined && row.endsAt !== null && !isValidIso(row.endsAt)) return false;
  if (!isAbsentOr(row.detail, isNonEmptyString)) return false;
  if (row.priceGbp !== undefined && row.priceGbp !== null) {
    if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  }
  return true;
}

// Data-derived event titles occasionally carry a typographic em or en dash
// (for example a scraped "Skehan's [em dash] Live Music"). The authored-copy
// sweep (#358) fixed hand-written strings but never touches data files, so the
// dash leaks onto Tonight and the What's-On spine. This is the
// render/normalisation seam: fold any em or en dash in a displayed title down
// to a plain spaced hyphen so no typographic dash survives. Bulk-editing the
// data files is deliberately avoided; the fix lives at the seam every row
// passes through. The character class uses unicode escapes (U+2014 em,
// U+2013 en) so this source file itself stays free of typographic dashes.
function foldDisplayDashes(value: string): string {
  return value
    .replace(/\s*[\u2014\u2013]\s*/g, " - ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function normaliseEventTitle(title: string): string {
  return foldDisplayDashes(title);
}

// The same dash leak (#373) reaches the provenance chip: a scraped source label
// like "Skehan's [em dash] Live Music" renders as "via Skehan's \u2014 Live Music" on
// Tonight. Fold the label at the same seam every displayed row passes through so
// no typographic dash survives in the source chip either.
export function normaliseSourceLabel(label: string): string {
  return foldDisplayDashes(label);
}

// Normalise a raw row into the exact WhatsOnRow shape, dropping null optionals
// so downstream `field !== undefined` checks behave.
function normaliseRow(row: WhatsOnRow): WhatsOnRow {
  const out: WhatsOnRow = {
    id: row.id,
    placeName: row.placeName,
    kind: row.kind,
    startsAt: row.startsAt,
    title: normaliseEventTitle(row.title),
    source: { label: normaliseSourceLabel(row.source.label), url: row.source.url },
    observedAt: row.observedAt,
    confidence: row.confidence,
  };
  if (isNonEmptyString(row.venueId)) out.venueId = row.venueId;
  if (isFiniteNumber(row.lat)) out.lat = row.lat;
  if (isFiniteNumber(row.lng)) out.lng = row.lng;
  if (isValidIso(row.endsAt)) out.endsAt = row.endsAt;
  if (isNonEmptyString(row.detail)) out.detail = row.detail;
  if (isFiniteNumber(row.priceGbp)) out.priceGbp = row.priceGbp;
  return out;
}

// Two rows collide when they describe the same (place, kind, startsAt). A row
// with a resolved venueId keys off it; otherwise it keys off the lowercased
// placeName (so a scraped-by-name row and its later venue-matched twin still
// collapse when the name is identical). The "|" separator is safe because ids
// and startsAt never contain it and a "|" in a pub name cannot create a
// collision across the three joined fields in practice.
export function dedupeKey(row: WhatsOnRow): string {
  const place = isNonEmptyString(row.venueId) ? row.venueId : row.placeName.toLowerCase();
  return `${place}|${row.kind}|${row.startsAt}`;
}

// Keep the freshest observedAt on collision (append-only supersede).
export function dedupeRows(rows: WhatsOnRow[]): WhatsOnRow[] {
  const byKey = new Map<string, WhatsOnRow>();
  for (const row of rows) {
    const key = dedupeKey(row);
    const existing = byKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

// Parse a raw whats-on file body into clean WhatsOnRow[]. Accepts either a bare
// array or a `{ rows: [...] }` envelope (which the quiz_london.json meta+rows
// shape and the latest.json envelope both satisfy). Malformed rows are dropped.
export function parseWhatsOnRows(raw: unknown, now: number = Date.now()): WhatsOnRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { rows?: unknown }).rows)
      ? (raw as { rows: unknown[] }).rows
      : [];
  const valid: WhatsOnRow[] = [];
  for (const row of rows) {
    if (isValidWhatsOnRow(row, now)) valid.push(normaliseRow(row));
  }
  return dedupeRows(valid);
}

// Before this hour (London local) "tonight" still belongs to the PREVIOUS
// calendar evening's window — the same rollback lib/tfl.ts uses so the small
// hours resolve against the evening that is still running.
export const SERVICE_DAY_ROLLBACK_HOUR = 4;
// The evening window opens at 16:00 and runs to 04:00 the next morning.
const WINDOW_OPEN_HOUR = 16;

type LondonParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function londonParts(base: Date): LondonParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// London's UTC offset (ms) at a given instant, derived by comparing the London
// wall-clock reading of `base` to `base` itself. +3600000 in summer (BST),
// 0 in winter (GMT).
function londonOffsetMs(base: Date): number {
  const p = londonParts(base);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(base.getTime() / 1000) * 1000;
}

// "Now" in Europe/London as a wall-clock Date (same approach as manchesterNow).
// Its local getHours()/getDate() read the London wall clock; do NOT use it as an
// absolute instant.
export function londonNow(base: Date = new Date()): Date {
  const p = londonParts(base);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// The "tonight" window as absolute ISO instants: [evening 16:00, next 04:00).
// Before 04:00 London, the evening date rolls back a day (the still-running
// evening). Offset is read at `now`; the span never crosses the 01:00 DST
// switch in a way that matters here, so a single offset is exact enough.
export function londonServiceDayBounds(now: number = Date.now()): { start: string; end: string } {
  const base = new Date(now);
  const p = londonParts(base);
  const offset = londonOffsetMs(base);

  let ey = p.year;
  let em = p.month;
  let ed = p.day;
  if (p.hour < SERVICE_DAY_ROLLBACK_HOUR) {
    const prev = new Date(Date.UTC(p.year, p.month - 1, p.day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    ey = prev.getUTCFullYear();
    em = prev.getUTCMonth() + 1;
    ed = prev.getUTCDate();
  }

  const startMs = Date.UTC(ey, em - 1, ed, WINDOW_OPEN_HOUR, 0, 0) - offset;
  const endMs = Date.UTC(ey, em - 1, ed + 1, SERVICE_DAY_ROLLBACK_HOUR, 0, 0) - offset;
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

// A point row carries no endsAt, so on its own it collapses to a zero-width
// instant at startsAt. That made an in-progress event vanish the moment its
// start passed: a 19:30 quiz dropped from the default path at 19:31 (#417).
// Give a point row a kind-aware effective DURATION instead, so its interval is
// [startsAt, startsAt + grace]. Each duration is the typical real run-length of
// that activity, picked conservatively (better to keep a just-finished row a
// little too long than to drop one that is still live):
//   quiz  ~3h    a pub quiz plus its wind-down runs about three hours.
//   music ~3h    a live-music or residency night runs a full set, about three hours.
//   sport ~2.5h  a match plus build-up and reaction runs about two and a half hours.
//   deal   0     deals always carry an explicit endsAt (their window is exact),
//                so a deal reaching here as a point gets no invented grace.
// Interval rows (any row WITH endsAt) are untouched: their endsAt stays exact.
const POINT_ROW_GRACE_MS: Record<WhatsOnKind, number> = {
  quiz: 3 * 60 * 60 * 1000,
  music: 3 * 60 * 60 * 1000,
  sport: 2.5 * 60 * 60 * 1000,
  deal: 0,
};

// Is the row happening during tonight's evening window?
//
// Overlap, not start-containment. The original test asked only whether
// `startsAt` fell inside [16:00, 04:00). That silently dropped every all-day
// row whose clock start is BEFORE the window opens but which is plainly still
// on through the evening: most visibly the Wetherspoon food deals, which all
// carry startsAt 11:30 and endsAt 23:00 and were therefore excluded from
// Tonight on EVERY night despite being live at 22:00. We treat the row as an
// interval [startsAt, effectiveEnd] via rowEffectiveEnd and include it when that
// interval overlaps the window. An interval row uses its exact endsAt; a point
// row uses its kind-aware effective end (POINT_ROW_GRACE_MS), so an in-progress
// quiz or match still overlaps the window and tonight windowing never disagrees
// with the past-dated guard (#417).
export function isOnTonight(row: WhatsOnRow, now: number = Date.now()): boolean {
  const { start, end } = londonServiceDayBounds(now);
  const startsAt = Date.parse(row.startsAt);
  if (!Number.isFinite(startsAt)) return false;
  const windowStart = Date.parse(start);
  const windowEnd = Date.parse(end);
  const effectiveEnd = rowEffectiveEnd(row);
  // Half-open window [windowStart, windowEnd): the row must begin before the
  // window closes and still be running at or after it opens.
  return startsAt < windowEnd && effectiveEnd >= windowStart;
}

export function filterTonight(rows: WhatsOnRow[], now: number = Date.now()): WhatsOnRow[] {
  return rows.filter((row) => isOnTonight(row, now));
}

// The instant a row stops being relevant: its explicit endsAt, or (for a point
// row that carries no endsAt) startsAt plus a kind-aware effective duration
// (POINT_ROW_GRACE_MS above). Same interval reading isOnTonight uses (#409/#417):
// a row is [startsAt, effectiveEnd]. Interval rows keep their exact endsAt; only
// point rows gain grace. Returns NaN only when startsAt itself is unparseable (a
// row that would already fail isValidWhatsOnRow).
export function rowEffectiveEnd(row: WhatsOnRow): number {
  const startsAt = Date.parse(row.startsAt);
  const parsedEnd = row.endsAt ? Date.parse(row.endsAt) : NaN;
  if (Number.isFinite(parsedEnd)) return parsedEnd; // interval row: exact endsAt
  if (!Number.isFinite(startsAt)) return startsAt; // unparseable start -> NaN
  return startsAt + POINT_ROW_GRACE_MS[row.kind]; // point row: kind-aware grace
}

// Freshness guard for the serving/build seam. A row is past-dated once its
// interval has ended: effectiveEnd < now. A point row (no endsAt) stays live for
// its kind-aware grace after startsAt (POINT_ROW_GRACE_MS), then goes past; an
// interval row (e.g. an all-day deal) stays live while it is still running,
// exactly like isOnTonight's overlap test.
//
// This is the #408 defence: the hand-curated sport-fixtures seed goes stale the
// moment a kickoff passes (crons are dead, so nothing re-derives it), and a
// stale bundled seed must never be SERVED. The tonight window path already
// scopes past rows out via filterTonight; this guards the default (no window)
// path, which would otherwise surface a played fixture forever.
export function isPastDated(row: WhatsOnRow, now: number = Date.now()): boolean {
  const end = rowEffectiveEnd(row);
  return Number.isFinite(end) && end < now;
}

export function filterNotPast(rows: WhatsOnRow[], now: number = Date.now()): WhatsOnRow[] {
  return rows.filter((row) => !isPastDated(row, now));
}

export function filterByKind(rows: WhatsOnRow[], kind: WhatsOnKind): WhatsOnRow[] {
  return rows.filter((row) => row.kind === kind);
}

export type VenueResolver = (placeName: string, lat?: number, lng?: number) => string | undefined;

// Attach a venueId to a row by resolving its placeName/coords. Left injectable
// so a scraped-by-name row can be matched later without this module importing
// the venue dataset (keeps it pure + cheap).
export function matchVenueId(row: WhatsOnRow, resolver: VenueResolver): WhatsOnRow {
  if (isNonEmptyString(row.venueId)) return row;
  const venueId = resolver(row.placeName, row.lat, row.lng);
  return venueId ? { ...row, venueId } : row;
}

// things_to_do kinds do not map 1:1 to our 4 whats-on kinds. Approved mapping:
// gig|nightlife → music, food_drink → deal. Everything else is DROPPED (honest
// partial live layer; sport/quiz arrive via the sibling scrapers).
export const THINGS_TO_DO_KIND_MAP: Record<string, WhatsOnKind> = {
  gig: "music",
  nightlife: "music",
  food_drink: "deal",
};

function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export type MapThingsToDoOpts = {
  now: number;
  // Best-effort ISO start for the requested window's London evening (used when
  // an opportunity carries no firm ISO start of its own).
  windowStart: string;
  // Optional per-title raw ISO starts (from fetchRawThingsToDoStartsAt) when the
  // upstream ever provides them.
  startsAtByTitle?: Map<string, string>;
};

// Map trimmed CityMCP opportunities to WhatsOnRow[] with confidence "listed".
// Drops any opp whose kind does not map, that lacks a place name, or whose
// source has no absolute-http url (provenance non-negotiable).
export function mapThingsToDoToRows(result: ThingsToDoResult, opts: MapThingsToDoOpts): WhatsOnRow[] {
  const observedAt = new Date(opts.now).toISOString();
  const rows: WhatsOnRow[] = [];
  for (const opp of result.opportunities) {
    const kind = opp.kind ? THINGS_TO_DO_KIND_MAP[opp.kind] : undefined;
    if (!kind) continue;
    const placeName = opp.place?.name;
    if (!isNonEmptyString(placeName)) continue;
    const label = opp.source?.label;
    const url = opp.source?.url;
    if (!isNonEmptyString(label) || !isHttpUrl(url)) continue;

    const rawStart = opts.startsAtByTitle?.get(opp.title);
    const startsAt = isValidIso(rawStart) ? (rawStart as string) : opts.windowStart;

    const detailBits: string[] = [];
    if (isNonEmptyString(opp.timeEvidence)) detailBits.push(`Listed time: ${opp.timeEvidence}`);
    if (isNonEmptyString(opp.price)) detailBits.push(opp.price);

    const row: WhatsOnRow = {
      id: stableId("whats-live", `${placeName}|${kind}|${startsAt}|${opp.title}`),
      placeName,
      kind,
      startsAt,
      title: normaliseEventTitle(opp.title),
      source: { label: normaliseSourceLabel(label), url: url as string },
      observedAt,
      confidence: "listed",
    };
    if (opp.place?.location) {
      row.lat = opp.place.location.lat;
      row.lng = opp.place.location.lng;
    }
    if (detailBits.length > 0) row.detail = detailBits.join(" · ");

    if (isValidWhatsOnRow(row, opts.now)) rows.push(row);
  }
  return dedupeRows(rows);
}

// A raw things_to_do call that PRESERVES any upstream startsAt the trimmed
// fetchThingsToDo drops. Used by the store's live merge. Does NOT edit
// client.ts — it calls callCityMcpTool directly. Returns a title→ISO-start
// map; empty when the upstream provides no firm starts (today's reality).
export type FetchRawStartsOpts = {
  window: "tonight" | "tomorrow_night" | "this_weekend";
  area?: string;
  limit?: number;
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchRawThingsToDoStartsAt(
  opts: FetchRawStartsOpts,
): Promise<Map<string, string>> {
  const args: Record<string, unknown> = { window: opts.window };
  if (opts.area) args.area = opts.area;
  if (typeof opts.limit === "number" && opts.limit > 0) args.limit = opts.limit;

  const result = await callCityMcpTool<Record<string, unknown>>("things_to_do", args, {
    timeoutMs: opts.timeoutMs,
    endpoint: opts.endpoint,
    fetchImpl: opts.fetchImpl,
  });
  const structured = result.structuredContent ?? {};
  const rawOpps = Array.isArray(structured.opportunities) ? structured.opportunities : [];

  const out = new Map<string, string>();
  for (const item of rawOpps) {
    if (!item || typeof item !== "object") continue;
    const o = item as ThingsToDoOpportunity & { startsAt?: unknown };
    const title = typeof o.title === "string" ? o.title : "";
    const startsAt = (o as { startsAt?: unknown }).startsAt;
    if (title && isValidIso(startsAt)) out.set(title, startsAt as string);
  }
  return out;
}
