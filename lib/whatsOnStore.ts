// Read-side store for the What's-On layer (Task B1). Baseline is the bundled
// static files (public/data/whats_on/*), live is an injectable CityMCP
// things_to_do merge. Fail-soft everywhere: a live-fetch throw degrades to
// baseline-only, never an error to the caller.

import { haversineKm } from "@/lib/haversine";
import { groupTonightListings } from "@/lib/tonightListGrouping";
import {
  dedupeKey,
  filterByKind,
  filterNotPast,
  filterTonight,
  mapThingsToDoToRows,
  parseWhatsOnRows,
  type WhatsOnKind,
  type WhatsOnKindObservedAt,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { fetchThingsToDo, type ThingsToDoResult } from "@/lib/citymcp/client";
import rawQuizLondon from "../public/data/whats_on/quiz_london.json";
import rawDealsLondon from "../public/data/whats_on/deals_london.json";
import rawSportFixtures from "../public/data/whats_on/sport_fixtures.json";
import rawMusicLondon from "../public/data/whats_on/music_london.json";
import rawEventsLondon from "../public/data/whats_on/events_london.json";
import rawWhatsOnLatest from "../public/data/whats_on/latest.json";

const BASELINE_DATASETS: unknown[] = [
  rawQuizLondon,
  rawDealsLondon,
  rawSportFixtures,
  rawMusicLondon,
  rawEventsLondon,
  rawWhatsOnLatest,
];

// Parse a bundled file with `now` fixed to the file's own generatedAt, so a row
// whose observedAt equals generatedAt is never rejected as "future" (mirrors the
// drink-updates pattern).
function generatedAtOf(raw: unknown): number {
  const at = Date.parse(String((raw as { generatedAt?: unknown })?.generatedAt ?? ""));
  return Number.isFinite(at) ? at : Date.now();
}

function canonicalPastIso(value: unknown, now: number): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > now) return null;
  return new Date(ms).toISOString();
}

function rowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return [];
  const rows = (raw as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

// The freshest confirmation the bundled inventory can show for itself.
//
// This used to answer the OLDEST contributing dataset, which meant one dataset
// nobody had rebuilt since July dated the whole page - the Tonight header read
// "Checked 18 Jul" off the July quiz file while the deals file beside it had
// been rebuilt that morning. Captain decision 2026-08-10: the stamp reports the
// freshest confirmation actually available at request time.
//
// The clause that keeps it honest is that a stamp about ONE source still comes
// from that source (see `WhatsOnKindObservedAt` below), so a July lane still
// says July. Nothing here invents a time: every candidate is a date somebody
// wrote into an artifact, and an empty sidecar contributes nothing because it
// serves no rows.
export function baselineSourceObservedAt(now: number = Date.now()): string | null {
  const generated = BASELINE_DATASETS.flatMap((raw) => {
    if (rowsOf(raw).length === 0) return [];
    const value = canonicalPastIso((raw as { generatedAt?: unknown }).generatedAt, now);
    return value ? [value] : [];
  });
  return freshestIso(generated);
}

/** Freshest of a list of canonical ISO strings, or null when there are none. */
function freshestIso(values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (best === null || Date.parse(value) > Date.parse(best)) best = value;
  }
  return best;
}

// Validated + de-duped baseline rows from every bundled whats_on rows file.
// Attribute sidecars are deliberately excluded; they carry no startsAt.
export function loadBaselineWhatsOn(): WhatsOnRow[] {
  const quiz = parseWhatsOnRows(rawQuizLondon, generatedAtOf(rawQuizLondon));
  const deals = parseWhatsOnRows(rawDealsLondon, generatedAtOf(rawDealsLondon));
  const sportFixtures = parseWhatsOnRows(rawSportFixtures, generatedAtOf(rawSportFixtures));
  const music = parseWhatsOnRows(rawMusicLondon, generatedAtOf(rawMusicLondon));
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
// an actual listing or confirmation on collision.
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

export type WhatsOnSourceFreshnessKind =
  | "provider-observed"
  | "dataset-generated"
  | "unknown";

export type WhatsOnLocalityBasis =
  | "live-location"
  | "remembered-patch"
  | "remembered-borough"
  | "london-default";

export type LoadWhatsOnParams = {
  kind?: WhatsOnKind;
  window?: "tonight";
  near?: { lat: number; lng: number };
  limit?: number;
  localityBasis?: WhatsOnLocalityBasis;
};

export type FetchLiveArgs = { now: number; area?: string; limit?: number };
export type FetchLiveResult = {
  rows: WhatsOnRow[];
  sourceObservedAt: string | null;
};
export type FetchLive = (args: FetchLiveArgs) => Promise<WhatsOnRow[] | FetchLiveResult>;

export type LoadWhatsOnDeps = {
  now?: number;
  loadBaseline?: () => WhatsOnRow[];
  baselineSourceObservedAt?: string | null;
  fetchLive?: FetchLive;
  /** PUBMAX_TONIGHT_GROUPING (DAG L14). When true, tonight grouping uses the
   *  canonical V2 model (schedule-aware key, deterministic locality tie-break,
   *  first-ten family diversity). Off keeps the shipped chain-duplicate collapse.
   *  The server handler reads the flag; defaulting to false keeps the safe off
   *  state and lets tests exercise both paths without env. */
  tonightGroupingV2?: boolean;
};

// Default live layer: CityMCP things_to_do mapped to whats-on rows. Final user
// limits are deliberately NOT forwarded to the provider call: the complete
// inventory must survive through grouping before the response limit is applied.
export const defaultFetchLive: FetchLive = async ({ now, area }) => {
  const result: ThingsToDoResult = await fetchThingsToDo({
    window: "tonight",
    ...(area ? { area } : {}),
  });
  return {
    rows: mapThingsToDoToRows(result, { now }),
    sourceObservedAt: canonicalPastIso(result.asOf, now),
  };
};

export type LoadWhatsOnResult = {
  rows: WhatsOnRow[];
  servedAt: string;
  sourceObservedAt: string | null;
  sourceFreshnessKind: WhatsOnSourceFreshnessKind;
  kindObservedAt: WhatsOnKindObservedAt;
  localityBasis: WhatsOnLocalityBasis;
  /** Compatibility alias for pre-L15 clients. It is source time, never request time. */
  asOf: string | null;
};

function normaliseLiveResult(
  result: WhatsOnRow[] | FetchLiveResult,
  now: number,
): FetchLiveResult {
  if (Array.isArray(result)) {
    const observed = result
      .map((row) => canonicalPastIso(row.observedAt, now))
      .filter((value): value is string => value !== null);
    return {
      rows: result,
      sourceObservedAt:
        observed.length === 0
          ? null
          : observed.reduce((latest, value) =>
              Date.parse(value) > Date.parse(latest) ? value : latest,
            ),
    };
  }
  return {
    rows: Array.isArray(result.rows) ? result.rows : [],
    sourceObservedAt: canonicalPastIso(result.sourceObservedAt, now),
  };
}

function flattenGroupsBeforeLimit(
  rows: WhatsOnRow[],
  near: { lat: number; lng: number } | null,
  limit: number | undefined,
  v2: boolean,
): WhatsOnRow[] {
  // Group the full inventory (V2 ordering + diversity when enabled) BEFORE the
  // caller's limit, so the limit selects whole families, not raw rows. Each
  // selected family is flattened back to hero + alternates so the shipped client
  // expander keeps its complete venue inventory.
  const groups = groupTonightListings(rows, near, { v2 });
  const selected = typeof limit === "number" && limit > 0 ? groups.slice(0, limit) : groups;
  return selected.flatMap((group) => [group.row, ...group.alternates]);
}

// Orchestrator: baseline union live (fail-soft), remove ended rows, apply the
// service window and locality ordering, group exact offer families, then apply
// the final card limit. Reads never present servedAt as source freshness.
export async function loadWhatsOn(
  params: LoadWhatsOnParams = {},
  deps: LoadWhatsOnDeps = {},
): Promise<LoadWhatsOnResult> {
  const now = deps.now ?? Date.now();
  const servedAt = new Date(now).toISOString();
  const baseline = (deps.loadBaseline ?? loadBaselineWhatsOn)();
  const datasetObservedAt =
    deps.baselineSourceObservedAt === undefined
      ? deps.loadBaseline
        ? null
        : baselineSourceObservedAt(now)
      : canonicalPastIso(deps.baselineSourceObservedAt, now);

  let live: FetchLiveResult = { rows: [], sourceObservedAt: null };
  try {
    // Do not pass params.limit. Grouping needs the provider's full inventory.
    live = normaliseLiveResult(await (deps.fetchLive ?? defaultFetchLive)({ now }), now);
  } catch {
    // Fail soft to baseline. A live layer that threw contributes no rows and no
    // freshness evidence, which is the same position as one that answered with
    // neither - so the outcome needs no separate flag.
  }

  let rows = filterNotPast(mergeWhatsOn(baseline, live.rows), now);
  if (params.kind) rows = filterByKind(rows, params.kind);
  if (params.window === "tonight") rows = filterTonight(rows, now);
  if (params.near) rows = sortByNear(rows, params.near);

  if (params.window === "tonight") {
    rows = flattenGroupsBeforeLimit(rows, params.near ?? null, params.limit, deps.tonightGroupingV2 ?? false);
  } else if (typeof params.limit === "number" && params.limit > 0) {
    rows = rows.slice(0, params.limit);
  }

  // Which of the rows we are about to serve may DATE themselves.
  //
  // A bundled row's observedAt was written into an artifact by a refresh that
  // really ran, so it is evidence. A LIVE row's is not: mapThingsToDoToRows
  // falls back to the request instant when the provider omits its own
  // timestamp, so a live row can date itself "now" with nobody having checked
  // anything. The live layer speaks only through its own sourceObservedAt.
  const liveRows = new Set(live.rows);
  const kindObservedAt: WhatsOnKindObservedAt = {};
  const bundledRowTimes: Array<string | null> = [];
  for (const row of rows) {
    const fromLive = liveRows.has(row);
    // A bundled row dates itself. A live row is dated by the provider's own
    // stated observation or not at all, so a kind carried entirely by the live
    // layer is still datable when the provider said when it looked.
    const observed = fromLive ? live.sourceObservedAt : canonicalPastIso(row.observedAt, now);
    if (!observed) continue;
    if (!fromLive) bundledRowTimes.push(observed);
    const held = kindObservedAt[row.kind];
    if (!held || Date.parse(observed) > Date.parse(held)) kindObservedAt[row.kind] = observed;
  }

  // The freshest confirmation available at request time, across the artifacts'
  // own build dates, the rows this answer actually carries, and the live
  // provider's stated observation. Never the request instant: `servedAt` is a
  // separate field and stays out of this.
  const bundledObservedAt = freshestIso([datasetObservedAt, ...bundledRowTimes]);
  let sourceObservedAt: string | null = null;
  let sourceFreshnessKind: WhatsOnSourceFreshnessKind = "unknown";
  if (
    live.sourceObservedAt &&
    (!bundledObservedAt || Date.parse(live.sourceObservedAt) >= Date.parse(bundledObservedAt))
  ) {
    sourceObservedAt = live.sourceObservedAt;
    sourceFreshnessKind = "provider-observed";
  } else if (bundledObservedAt) {
    sourceObservedAt = bundledObservedAt;
    sourceFreshnessKind = "dataset-generated";
  }

  const localityBasis = params.near
    ? (params.localityBasis ?? "live-location")
    : (params.localityBasis ?? "london-default");

  return {
    rows,
    servedAt,
    sourceObservedAt,
    sourceFreshnessKind,
    kindObservedAt,
    localityBasis,
    asOf: sourceObservedAt,
  };
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
