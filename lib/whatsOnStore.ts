// Read-side store for the What's-On layer (Task B1). Baseline is the bundled
// static files (public/data/whats_on/*), live is an injectable CityMCP
// things_to_do merge. Fail-soft everywhere: a live-fetch throw degrades to
// baseline-only, never an error to the caller.

import { haversineKm } from "@/lib/haversine";
import {
  dedupeKey,
  fetchRawThingsToDoStartsAt,
  filterByKind,
  filterTonight,
  londonServiceDayBounds,
  mapThingsToDoToRows,
  parseWhatsOnRows,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { fetchThingsToDo, type ThingsToDoResult } from "@/lib/citymcp/client";
import rawQuizLondon from "../public/data/whats_on/quiz_london.json";
import rawDealsLondon from "../public/data/whats_on/deals_london.json";
import rawSportFixtures from "../public/data/whats_on/sport_fixtures.json";
import rawMusicLondon from "../public/data/whats_on/music_london.json";
import rawEventsLondon from "../public/data/whats_on/events_london.json";
import rawWhatsOnLatest from "../public/data/whats_on/latest.json";

// Parse a bundled file with `now` fixed to the file's own generatedAt, so a row
// whose observedAt equals generatedAt is never rejected as "future" (mirrors the
// drink-updates pattern).
function generatedAtOf(raw: unknown): number {
  const at = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(at) ? at : Date.now();
}

// Validated + de-duped baseline rows from every bundled whats_on rows file.
// (Attribute sidecars like sport_attributes.json are a different contract and
// are deliberately NOT loaded here — they carry no startsAt. sport_fixtures.json
// IS loaded: it derives startsAt rows from sport_attributes.json x a fixture
// calendar — see scripts/whatson/sportFixtures.mjs. music_london.json is a
// small, hand-verified set of weekly residency-night rows — see
// scripts/whatson/musicRefresh.mjs.)
export function loadBaselineWhatsOn(): WhatsOnRow[] {
  const quiz = parseWhatsOnRows(rawQuizLondon, generatedAtOf(rawQuizLondon));
  const deals = parseWhatsOnRows(rawDealsLondon, generatedAtOf(rawDealsLondon));
  const sportFixtures = parseWhatsOnRows(rawSportFixtures, generatedAtOf(rawSportFixtures));
  const music = parseWhatsOnRows(rawMusicLondon, generatedAtOf(rawMusicLondon));
  // events_london.json is the live-API vertical (Ticketmaster/Skiddle). It ships
  // empty until provider keys land (see scripts/whatson/eventsRefresh.mjs), so
  // today this contributes 0 rows; it lights up with no store change.
  const events = parseWhatsOnRows(rawEventsLondon, generatedAtOf(rawEventsLondon));
  const latest = parseWhatsOnRows(rawWhatsOnLatest, generatedAtOf(rawWhatsOnLatest));
  const byKey = new Map<string, WhatsOnRow>();
  for (const row of [...quiz, ...deals, ...sportFixtures, ...music, ...events, ...latest]) {
    const key = dedupeKey(row);
    const existing = byKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

// derived < listed < confirmed: a cross-referenced inference never outranks
// an actual listing or confirmation on collision (mergeWhatsOn below).
const CONFIDENCE_RANK: Record<WhatsOnRow["confidence"], number> = {
  confirmed: 2,
  listed: 1,
  derived: 0,
};

// Union baseline + live, de-duped by the same (place, kind, startsAt) key. A
// confirmed baseline row beats a listed live row on collision; otherwise the
// freshest observedAt wins.
export function mergeWhatsOn(baseline: WhatsOnRow[], live: WhatsOnRow[]): WhatsOnRow[] {
  const byKey = new Map<string, WhatsOnRow>();
  for (const row of [...baseline, ...live]) {
    const key = dedupeKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const rankDelta = CONFIDENCE_RANK[row.confidence] - CONFIDENCE_RANK[existing.confidence];
    if (rankDelta > 0) byKey.set(key, row);
    else if (rankDelta === 0 && Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

// A row more than this far in the past is treated as a finished event still
// sitting in a bundled static file (nothing expires those on its own) rather
// than something worth serving. The "tonight" window already excludes
// past-window rows via filterTonight/isOnTonight, so this only bites on the
// DEFAULT (no window) query path — the one that would otherwise serve a
// derived sport fixture (or any other row) forever once its kickoff has
// passed.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function dropStale(rows: WhatsOnRow[], now: number): WhatsOnRow[] {
  return rows.filter((row) => {
    const startsAt = Date.parse(row.startsAt);
    return !Number.isFinite(startsAt) || now - startsAt < STALE_AFTER_MS;
  });
}

export type LoadWhatsOnParams = {
  kind?: WhatsOnKind;
  window?: "tonight";
  near?: { lat: number; lng: number };
  limit?: number;
};

export type FetchLiveArgs = { now: number; area?: string; limit?: number };
export type FetchLive = (args: FetchLiveArgs) => Promise<WhatsOnRow[]>;

export type LoadWhatsOnDeps = {
  now?: number;
  loadBaseline?: () => WhatsOnRow[];
  fetchLive?: FetchLive;
};

// Default live layer: CityMCP things_to_do (trimmed) mapped to whats-on rows,
// with best-effort raw starts. Any throw propagates so loadWhatsOn can fail-soft.
export const defaultFetchLive: FetchLive = async ({ now, area, limit }) => {
  const result: ThingsToDoResult = await fetchThingsToDo({
    window: "tonight",
    ...(area ? { area } : {}),
    ...(limit ? { limit } : {}),
  });
  let startsAtByTitle: Map<string, string> | undefined;
  try {
    startsAtByTitle = await fetchRawThingsToDoStartsAt({ window: "tonight", area, limit });
  } catch {
    startsAtByTitle = undefined; // raw starts are a best-effort enrichment only
  }
  const windowStart = londonServiceDayBounds(now).start;
  return mapThingsToDoToRows(result, { now, windowStart, startsAtByTitle });
};

export type LoadWhatsOnResult = { rows: WhatsOnRow[]; asOf: string };

// Orchestrator: baseline union live (fail-soft), then kind / tonight / near / limit.
export async function loadWhatsOn(
  params: LoadWhatsOnParams = {},
  deps: LoadWhatsOnDeps = {},
): Promise<LoadWhatsOnResult> {
  const now = deps.now ?? Date.now();
  const baseline = (deps.loadBaseline ?? loadBaselineWhatsOn)();

  let live: WhatsOnRow[] = [];
  try {
    live = await (deps.fetchLive ?? defaultFetchLive)({ now, limit: params.limit });
  } catch {
    live = []; // fail-soft: live down → baseline only
  }

  let rows = mergeWhatsOn(baseline, live);
  if (!params.window) rows = dropStale(rows, now);
  if (params.kind) rows = filterByKind(rows, params.kind);
  if (params.window === "tonight") rows = filterTonight(rows, now);
  if (params.near) rows = sortByNear(rows, params.near);
  if (typeof params.limit === "number" && params.limit > 0) rows = rows.slice(0, params.limit);

  return { rows, asOf: new Date(now).toISOString() };
}

// Ascending haversine sort; rows without coords sort last (stable among each
// other). Coordinates follow the app's [lng, lat] haversine convention.
function sortByNear(rows: WhatsOnRow[], near: { lat: number; lng: number }): WhatsOnRow[] {
  const distance = (row: WhatsOnRow): number => {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return Number.POSITIVE_INFINITY;
    return haversineKm([row.lng as number, row.lat as number], [near.lng, near.lat]);
  };
  return [...rows]
    .map((row, idx) => ({ row, idx, d: distance(row) }))
    .sort((a, b) => a.d - b.d || a.idx - b.idx)
    .map((x) => x.row);
}
