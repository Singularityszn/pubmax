// Client-side loader that transparently resolves the SLIM venue index's shards.
//
// #315 grew venues_slim.json to ~805 KB by adding Outer-London presence pins.
// scripts/build_slim_index.mjs now emits, alongside the monolithic file:
//   • venues_slim.manifest.json — shard -> { url, bbox, count } (tiny, eager)
//   • venues_slim.core.json     — the priced inner-London index (eager)
//   • venues_slim.{shard}.json - lazy borough and curated-kind shards
//
// The MAP is the only true first-paint surface, so it loads CORE eagerly and
// pulls a lazy shard only when it actually needs it:
//   (a) the viewport intersects that borough's bbox,
//   (b) near-me geolocates into it.
// Everything is one code path: consumers hold a loader from
// createSlimShardLoader() and call core()/inBounds()/nearPoint()/all(); the
// loader hides fetching, dedup, offline mirroring, and the non-sharded
// fallback for cities that ship a single file (no manifest).
//
// Degradation: a shard fetch that fails with no offline mirror yields [] and is
// NOT marked loaded, so the next moveend / near-me retries it. The map keeps
// working with whatever shards did load. Cache-first `/data/*.json` handling in
// public/sw.js already covers every shard URL (see its strategy table).

import { discardBody } from "@/lib/responseBody";
import { takeEarlyWarmJson } from "@/lib/mapEarlyWarm";
import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { offlineCache } from "@/lib/offlineCache";
import { loadSlimVenuesFromPath, type SlimVenue } from "@/lib/venuesSlim";

/** [minLng, minLat, maxLng, maxLat] — GeoJSON bbox order (matches the build). */
export type ShardBbox = [number, number, number, number];

export type ShardEntry = {
  id: string;
  core: boolean;
  url: string;
  count: number;
  bbox: ShardBbox;
  partition?: "borough" | "kind";
  borough?: string;
};

export type ShardManifest = {
  version: number;
  shards: ShardEntry[];
};

/** A map viewport as edges (west/east longitude, south/north latitude). */
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// --- pure geometry + manifest validation (unit-tested) -----------------------

function isBbox(value: unknown): value is ShardBbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** Parse an unknown payload into a ShardManifest, or null if malformed. */
export function parseShardManifest(value: unknown): ShardManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== "number") return null;
  if (!Array.isArray(obj.shards)) return null;
  const shards: ShardEntry[] = [];
  for (const raw of obj.shards) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id) return null;
    if (typeof s.url !== "string" || !s.url) return null;
    if (typeof s.count !== "number") return null;
    if (typeof s.core !== "boolean") return null;
    if (!isBbox(s.bbox)) return null;
    if (
      s.partition !== undefined &&
      s.partition !== "borough" &&
      s.partition !== "kind"
    ) {
      return null;
    }
    if (s.partition === "borough" && typeof s.borough !== "string") return null;
    if (s.partition === "kind" && s.borough !== undefined) return null;
    shards.push({
      id: s.id,
      core: s.core,
      url: s.url,
      count: s.count,
      bbox: s.bbox,
      ...(s.partition !== undefined
        ? { partition: s.partition as "borough" | "kind" }
        : {}),
      ...(typeof s.borough === "string" ? { borough: s.borough } : {}),
    });
  }
  return { version: obj.version, shards };
}

/** Does a shard bbox overlap the viewport bounds? (inclusive edges) */
export function bboxIntersects(bbox: ShardBbox, bounds: MapBounds): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return (
    minLng <= bounds.east &&
    maxLng >= bounds.west &&
    minLat <= bounds.north &&
    maxLat >= bounds.south
  );
}

/** Is a point inside a shard bbox? */
export function bboxContainsPoint(bbox: ShardBbox, lat: number, lng: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/** Non-core shards whose bbox intersects the viewport. */
export function shardsForBounds(manifest: ShardManifest, bounds: MapBounds): ShardEntry[] {
  return manifest.shards.filter((s) => !s.core && bboxIntersects(s.bbox, bounds));
}

/**
 * Has every shard that could hold a venue inside `bounds` already loaded?
 *
 * The counter-question to `shardsForBounds`: that one asks what to FETCH, this
 * one asks whether a figure derived from the loaded pins is the whole truth for
 * that patch of the map. Core counts too - a bbox that only core covers is
 * complete the moment core lands.
 */
export function boundsCoveredByLoadedShards(
  manifest: ShardManifest,
  loadedShardUrls: ReadonlySet<string>,
  bounds: MapBounds,
): boolean {
  return manifest.shards
    .filter((shard) => bboxIntersects(shard.bbox, bounds))
    .every((shard) => loadedShardUrls.has(shard.url));
}

/**
 * The outer shard a point falls in. Prefers a bbox that CONTAINS the point;
 * when several do (bboxes can overlap) or none does but one is close, picks the
 * shard whose bbox centre is nearest. Returns null when there is no plausible
 * outer shard (the point is squarely in core territory).
 */
export function shardForPoint(
  manifest: ShardManifest,
  lat: number,
  lng: number,
): ShardEntry | null {
  const outer = manifest.shards.filter(
    (s) => !s.core && s.partition !== "kind",
  );
  const containing = outer.filter((s) => bboxContainsPoint(s.bbox, lat, lng));
  const pool = containing.length > 0 ? containing : [];
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  let best: ShardEntry | null = null;
  let bestDist = Infinity;
  for (const s of pool) {
    const cLng = (s.bbox[0] + s.bbox[2]) / 2;
    const cLat = (s.bbox[1] + s.bbox[3]) / 2;
    const d = (cLng - lng) ** 2 + (cLat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// --- stateful per-city loader ------------------------------------------------

const MANIFEST_OFFLINE_PREFIX = "venues_slim_manifest:v1";

function manifestPathFor(slimVenuesPath: string): string {
  return slimVenuesPath.replace(/\.json$/, ".manifest.json");
}

/** Guessed core shard URL for a city's slim index (London: venues_slim.core.json). */
export function guessedCoreShardUrl(slimVenuesPath: string): string {
  return slimVenuesPath.replace(/\.json$/, ".core.json");
}

export type SlimShardLoader = {
  /** Eager first-paint payload: the core shard. */
  core(): Promise<SlimVenue[]>;
  /**
   * Venues from outer shards intersecting `bounds` that are not already
   * loaded. Returns [] when nothing new is needed. Never throws.
   */
  inBounds(bounds: MapBounds): Promise<SlimVenue[]>;
  /**
   * Venues from the outer shard containing `point`, loaded (with one retry) if
   * needed. [] when the point is in core territory or the shard can't load.
   */
  nearPoint(lat: number, lng: number): Promise<SlimVenue[]>;
  /** Core + every outer shard (for by-id / whole-index consumers). */
  all(): Promise<SlimVenue[]>;
  /**
   * Whether every shard that could hold a venue inside `bounds` has loaded, so
   * a count taken over the loaded pins is complete for that patch. TRI-STATE:
   * `null` while the manifest has not answered, because "we cannot tell yet"
   * is not "incomplete" and neither is it a figure anybody may print.
   */
  coverageComplete(bounds: MapBounds): boolean | null;
};

/**
 * Build a loader bound to one city. Fetches (and offline-mirrors) the manifest
 * once; on a manifest miss (a city that still ships a single slim file) it
 * degrades to loading that whole file as "core", with inBounds/nearPoint
 * returning [] — exactly today's non-sharded behaviour.
 */
export function createSlimShardLoader(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): SlimShardLoader {
  const city = getCity(cityId);
  const slimVenuesPath = city.slimVenuesPath;
  const manifestPath = manifestPathFor(slimVenuesPath);
  const manifestOfflineKey = `${MANIFEST_OFFLINE_PREFIX}:${manifestPath}`;

  let manifestPromise: Promise<ShardManifest | null> | null = null;
  // Settled manifest snapshot, so coverage can be answered without awaiting.
  let manifestAnswered = false;
  let settledManifest: ShardManifest | null = null;
  // A city with no manifest ships one file, so loading it covers everything.
  let wholeIndexLoaded = false;
  // url -> in-flight/settled fetch of that shard's venues.
  const shardPromises = new Map<string, Promise<SlimVenue[]>>();
  // shard urls that have successfully contributed venues (so inBounds skips them).
  const loadedUrls = new Set<string>();

  async function fetchManifest(): Promise<ShardManifest | null> {
    try {
      let payload: unknown;
      const early = takeEarlyWarmJson(manifestPath);
      if (early) {
        try {
          payload = await early;
        } catch {
          payload = undefined;
        }
      }
      if (payload === undefined) {
        const response = await fetch(manifestPath);
        if (!response.ok) {
          discardBody(response);
          throw new Error(`HTTP ${response.status}`);
        }
        payload = await response.json();
      }
      const parsed = parseShardManifest(payload);
      if (parsed) void offlineCache.set(manifestOfflineKey, parsed);
      return parsed;
    } catch {
      const stored = await offlineCache.get<unknown>(manifestOfflineKey);
      return parseShardManifest(stored);
    }
  }

  function manifest(): Promise<ShardManifest | null> {
    if (!manifestPromise) {
      manifestPromise = fetchManifest().then((parsed) => {
        settledManifest = parsed;
        manifestAnswered = true;
        return parsed;
      });
    }
    return manifestPromise;
  }

  function loadWholeIndex(): Promise<SlimVenue[]> {
    return loadSlimVenuesFromPath(slimVenuesPath).then((rows) => {
      wholeIndexLoaded = true;
      return rows;
    });
  }

  // Fetch one shard body once; a failure (no offline mirror) resolves to [] and
  // is NOT memoized as loaded, so a later call retries it.
  function loadShard(url: string): Promise<SlimVenue[]> {
    const existing = shardPromises.get(url);
    if (existing) return existing;
    const p = loadSlimVenuesFromPath(url)
      .then((rows) => {
        loadedUrls.add(url);
        return rows;
      })
      .catch(() => {
        shardPromises.delete(url); // allow retry
        return [] as SlimVenue[];
      });
    shardPromises.set(url, p);
    return p;
  }

  function coreEntry(m: ShardManifest): ShardEntry | undefined {
    return m.shards.find((s) => s.core);
  }

  return {
    async core(): Promise<SlimVenue[]> {
      const guessedCoreUrl = guessedCoreShardUrl(slimVenuesPath);
      // Speculative: started beside the manifest so first paint does not wait
      // for one round trip before starting the next. It is only ever AWAITED
      // once the manifest names that very URL as its core, so a city with no
      // manifest (or a differently named core) is not serialised behind a
      // request its answer discards. loadShard never rejects.
      const guessedRows = loadShard(guessedCoreUrl);
      const m = await manifest();
      if (!m) return loadWholeIndex();
      const core = coreEntry(m);
      if (!core) return loadWholeIndex();
      if (core.url === guessedCoreUrl) {
        const rows = await guessedRows;
        if (rows.length > 0) return rows;
      }
      return loadShard(core.url);
    },

    async inBounds(bounds: MapBounds): Promise<SlimVenue[]> {
      const m = await manifest();
      if (!m) return [];
      const needed = shardsForBounds(m, bounds).filter((s) => !loadedUrls.has(s.url));
      if (needed.length === 0) return [];
      const results = await Promise.all(needed.map((s) => loadShard(s.url)));
      return results.flat();
    },

    async nearPoint(lat: number, lng: number): Promise<SlimVenue[]> {
      const m = await manifest();
      if (!m) return [];
      const shard = shardForPoint(m, lat, lng);
      if (!shard) return [];
      if (loadedUrls.has(shard.url)) return [];
      let rows = await loadShard(shard.url);
      if (rows.length === 0 && !loadedUrls.has(shard.url)) {
        // One honest retry before giving up (transient cellar signal).
        rows = await loadShard(shard.url);
      }
      return rows;
    },

    async all(): Promise<SlimVenue[]> {
      const m = await manifest();
      if (!m) return loadWholeIndex();
      const results = await Promise.all(m.shards.map((s) => loadShard(s.url)));
      return results.flat();
    },

    coverageComplete(bounds: MapBounds): boolean | null {
      if (wholeIndexLoaded) return true;
      if (!manifestAnswered) return null;
      if (!settledManifest) return false;
      return boundsCoveredByLoadedShards(settledManifest, loadedUrls, bounds);
    },
  };
}
