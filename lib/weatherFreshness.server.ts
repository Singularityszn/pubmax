// Server-side read-through freshness for weather surfaces that must never show
// stale readings, regardless of cron cadence or whether migration 0047 has
// landed. The cron plane pre-warms the durable store every 6h; this module is
// the safety net for the gaps between runs (and for the window before the
// durable table exists, when the store falls back to per-instance memory the
// scheduled write cannot durably keep warm).
//
// Ordering, honest freshness:
//   1. Read the freshest available snapshot via loadWeatherSnapshot
//      (durable store -> memory -> committed public/data/weather/latest.json).
//   2. If that snapshot was generated within the freshness window (~90 min), it
//      is current enough — serve it, no network.
//   3. Otherwise fetch live from Open-Meteo server-side, REUSING the exact
//      provider + contract the cron uses (fetchNightAreaObservations). On
//      success we cache the batch back through weatherSnapshotStore() — which is
//      in-process memory when keyless and durable Supabase when configured — and
//      serve it, so staleness disappears.
//   4. Fail-soft: a live fetch that throws or yields nothing falls back to the
//      freshest cached/committed snapshot, which the caller (buildWeatherBrief)
//      still renders with its honest "last checked" staleness line.
//
// This module is server-only (it can touch the network and the durable store).
// It is kept OUT of the pure lib/weatherSnapshots.ts / lib/todayBrief.ts on
// purpose, exactly like lib/weatherSnapshots.server.ts.
//
// No em dashes or en dashes (VOICE.md product-copy rule extends to code prose).

import { errorMessage } from "@/lib/storeBackend";
import {
  fetchNightAreaObservations,
  type FetchObservationsResult,
} from "@/lib/weatherProvider";
import {
  validateWeatherSnapshot,
  WEATHER_SNAPSHOT_VERSION,
  type WeatherSnapshot,
} from "@/lib/weatherSnapshots";
import { loadWeatherSnapshot, type LoadWeatherSnapshotDeps } from "@/lib/weatherSnapshots.server";
import { weatherSnapshotStore, type WeatherSnapshotStore } from "@/lib/weatherSnapshotStore";

// ~90 minutes. Comfortably inside the cron's 6h cadence and the 12h observation
// TTL, but tight enough that a page view between cron runs triggers a live
// top-up rather than serving readings that are already hours old.
export const WEATHER_READTHROUGH_MAX_AGE_MS = 90 * 60_000;

/**
 * Pure freshness predicate: is this snapshot recent enough to serve without a
 * live top-up? A missing snapshot, an unparseable stamp, or a future-dated stamp
 * (clock skew / bad data) all read as NOT fresh. Exported so the threshold is
 * unit-testable in isolation.
 */
export function isWeatherFresh(
  snapshot: WeatherSnapshot | null,
  nowMs: number,
  maxAgeMs: number = WEATHER_READTHROUGH_MAX_AGE_MS,
): boolean {
  if (!snapshot) return false;
  const generatedMs = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedMs)) return false;
  if (generatedMs > nowMs) return false;
  return nowMs - generatedMs <= maxAgeMs;
}

export type FreshWeatherDeps = {
  /** Clock (defaults to now). */
  now?: Date;
  /** Freshness window before a live top-up is attempted. */
  maxAgeMs?: number;
  /**
   * Test seam: reader for the freshest cached snapshot (store-first, committed
   * fallback). Defaults to loadWeatherSnapshot.
   */
  loadFreshest?: (deps?: LoadWeatherSnapshotDeps) => Promise<WeatherSnapshot | null>;
  /** Passed through to loadFreshest so tests can inject store/committed. */
  loadDeps?: LoadWeatherSnapshotDeps;
  /** Test seam: the live provider fetch (defaults to the cron's fetcher). */
  fetchObservations?: () => Promise<FetchObservationsResult>;
  /** Test seam: the cache backend (defaults to the selected store). */
  store?: WeatherSnapshotStore;
};

// Single-flight: while one live top-up is in progress, concurrent stale reads on
// the same instance share it rather than each firing 20 provider calls. Cleared
// when the fetch settles (and by __resetWeatherReadThrough for hermetic tests).
let inFlightTopUp: Promise<WeatherSnapshot | null> | null = null;

async function fetchAndCache(
  doFetch: () => Promise<FetchObservationsResult>,
  store: WeatherSnapshotStore,
  now: Date,
): Promise<WeatherSnapshot | null> {
  let result: FetchObservationsResult;
  try {
    result = await doFetch();
  } catch (err) {
    console.warn(`[weather-readthrough] live fetch failed, serving cached: ${errorMessage(err)}`);
    return null;
  }
  const { observations } = result;
  // A total provider outage yields nothing worth serving; fall back to cached.
  if (observations.length === 0) return null;

  const generatedAt = now.toISOString();
  const snapshot = validateWeatherSnapshot({
    version: WEATHER_SNAPSHOT_VERSION,
    generatedAt,
    observations,
  });
  // The provider validates every observation, but guard the assembled batch too
  // (e.g. provider clock ahead of ours making observedAt > generatedAt): never
  // serve an invalid snapshot as if it were fresh.
  if (!snapshot) return null;

  // Best-effort cache. writeSnapshot never throws by contract; a degraded
  // durable write still leaves us the fresh live snapshot to serve right now,
  // which is the read-through's only job (the cron owns durability).
  await store.writeSnapshot(observations, generatedAt);
  return snapshot;
}

/**
 * Resolve the weather snapshot a server surface should serve, guaranteeing it is
 * never needlessly stale: freshest cached snapshot when recent, else a live
 * Open-Meteo top-up, else fail-soft to the freshest cached/committed snapshot.
 * Never throws for data reasons and never fabricates a reading.
 */
export async function loadFreshWeatherSnapshot(
  deps: FreshWeatherDeps = {},
): Promise<WeatherSnapshot | null> {
  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const maxAgeMs = deps.maxAgeMs ?? WEATHER_READTHROUGH_MAX_AGE_MS;
  const readFreshest = deps.loadFreshest ?? loadWeatherSnapshot;
  const doFetch = deps.fetchObservations ?? (() => fetchNightAreaObservations());
  const store = deps.store ?? weatherSnapshotStore();

  const cached = await readFreshest(deps.loadDeps);
  if (isWeatherFresh(cached, nowMs, maxAgeMs)) return cached;

  // Stale or missing: attempt one shared live top-up.
  if (!inFlightTopUp) {
    inFlightTopUp = fetchAndCache(doFetch, store, now).finally(() => {
      inFlightTopUp = null;
    });
  }
  const live = await inFlightTopUp;

  // Live succeeded: serve fresh. Live failed: serve the freshest cached/committed
  // snapshot so the card still paints (with its honest staleness banner).
  return live ?? cached;
}

/** Test-only: clear the single-flight latch between hermetic cases. */
export function __resetWeatherReadThrough(): void {
  inFlightTopUp = null;
}
