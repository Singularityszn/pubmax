// Client-safe loader for the SLIM venue index (public/data/venues_slim.json,
// built by scripts/build_slim_index.mjs). This is the minimum the map needs to
// render pins + labels + price colour: the map fetches THIS (~140 KB) on load
// instead of the ~6 MB raw price dataset, and fetches heavy per-venue detail
// lazily via /api/venue/[id] only when a pub is opened.
//
// SlimVenue.id is byte-identical to the "venue-…" id groupVenuePrices produces
// (the build script mirrors its FNV-1a grouping), so a slim pin deep-links and
// fetches detail by the same id the rest of the app uses.
//
// Mirrors lib/pois.ts#loadPois defensiveness: hand/refresh-generated JSON can
// drift, so malformed rows are dropped rather than allowed to poison the map.
//
// Offline (issue #32): the service worker caches the /data/… bytes; on top of
// that, every successful load is mirrored into IndexedDB (lib/offlineCache.ts)
// so a fetch that fails ENTIRELY (no SW yet, dead cellar signal on a cold tab)
// can still return the last parsed index instead of an empty map.

import { offlineCache } from "@/lib/offlineCache";

const OFFLINE_KEY = "venues_slim:v1";
export const SLIM_VENUES_PATH = "/data/venues_slim.json";

export type SlimVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
};

// Light runtime guard: a row must have a non-empty id + name, finite coords, a
// borough string, and a cheapestPrice that is either a finite number or null.
function isValidSlimVenue(value: unknown): value is SlimVenue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) return false;
  if (typeof row.name !== "string" || row.name.length === 0) return false;
  if (typeof row.borough !== "string") return false;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat)) return false;
  if (typeof row.lng !== "number" || !Number.isFinite(row.lng)) return false;
  const price = row.cheapestPrice;
  const priceOk =
    price === null || (typeof price === "number" && Number.isFinite(price));
  return priceOk;
}

// Normalise each surviving row to exactly the SlimVenue shape so no stray
// dataset field ever rides along into the client render path. Applied to BOTH
// the network payload and the IndexedDB fallback (a stored payload from an
// older build gets the same distrust as fresh JSON).
function normalizeRows(data: unknown): SlimVenue[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isValidSlimVenue).map((venue) => ({
    id: venue.id,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    cheapestPrice: venue.cheapestPrice,
    borough: venue.borough,
  }));
}

/**
 * Fetches the bundled slim venue index (client-side), mirroring PubMap.tsx's
 * fetch of the pint dataset. Malformed rows are filtered out so callers always
 * get a clean SlimVenue[]; a non-array payload yields [] so the map degrades to
 * "no pins" rather than throwing.
 *
 * Offline: a good load is mirrored to IndexedDB (fire-and-forget); if the
 * fetch itself fails, the last mirrored index is returned instead. Only when
 * there is no fallback either does the original error propagate — preserving
 * the pre-offline contract for callers that show a load-error state.
 */
export async function loadSlimVenues(): Promise<SlimVenue[]> {
  try {
    const response = await fetch(SLIM_VENUES_PATH);
    const data: unknown = await response.json();
    const rows = normalizeRows(data);
    if (rows.length > 0) void offlineCache.set(OFFLINE_KEY, rows);
    return rows;
  } catch (error) {
    const stored = await offlineCache.get<unknown>(OFFLINE_KEY);
    const fallback = normalizeRows(stored);
    if (fallback.length > 0) return fallback;
    throw error;
  }
}
