// Client-safe loader for the SLIM venue index (public/data/venues_slim.json,
// built by scripts/build_slim_index.mjs). This is the minimum the map needs to
// render pins + labels + price colour + filter hints: the map fetches THIS
// (~400 KB) on load
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

import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { offlineCache } from "@/lib/offlineCache";
import type { VenueFilterHints } from "@/lib/venues";

const OFFLINE_KEY_PREFIX = "venues_slim:v1";
/** London legacy path — kept for back-compat with existing caches and tests. */
export const SLIM_VENUES_PATH = "/data/venues_slim.json";

function offlineKeyForPath(path: string): string {
  return path === SLIM_VENUES_PATH
    ? OFFLINE_KEY_PREFIX
    : `${OFFLINE_KEY_PREFIX}:${path}`;
}

export type SlimVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  /**
   * Nearest-station TfL fare zone (1–6, occasionally 7–9 at the London edge).
   * Absent when no station was comparable — honestly unknown, never bucketed.
   */
  zone?: number;
  filterHints?: VenueFilterHints;
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFilterHints(value: unknown): value is VenueFilterHints {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.searchText !== "string") return false;
  if (typeof row.amenities !== "object" || row.amenities === null) return false;
  if (typeof row.curation !== "object" || row.curation === null) return false;
  const amenities = row.amenities as Record<string, unknown>;
  const curation = row.curation as Record<string, unknown>;
  // Optional soft arrays (Wave C drink lens + Wave E cuisine tags).
  if (row.cuisineTags !== undefined && !isStringArray(row.cuisineTags)) return false;
  if (row.drinkCategories !== undefined && !isStringArray(row.drinkCategories)) return false;
  if (row.drinkBrands !== undefined && !isStringArray(row.drinkBrands)) return false;
  if (row.drinkSubtypes !== undefined && !isStringArray(row.drinkSubtypes)) return false;
  if (row.drinkText !== undefined && typeof row.drinkText !== "string") return false;
  if (row.topShelf !== undefined && !isBoolean(row.topShelf)) return false;
  if (row.scraped !== undefined && !isBoolean(row.scraped)) return false;
  return (
    isBoolean(amenities.food) &&
    isBoolean(amenities.cocktails) &&
    isBoolean(amenities.beerGarden) &&
    isBoolean(amenities.liveSports) &&
    isBoolean(amenities.nonAlcoholic) &&
    isBoolean(curation.nearWater) &&
    isBoolean(curation.hasStory) &&
    isBoolean(row.canonical)
  );
}

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
  // zone, when present, must be a positive integer (fare zone). Absent is fine.
  const zoneOk =
    row.zone === undefined ||
    (typeof row.zone === "number" && Number.isInteger(row.zone) && row.zone > 0);
  return (
    priceOk &&
    zoneOk &&
    (row.filterHints === undefined || isFilterHints(row.filterHints))
  );
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
    ...(venue.zone !== undefined ? { zone: venue.zone } : {}),
    ...(venue.filterHints ? { filterHints: venue.filterHints } : {}),
  }));
}

/**
 * Fetches a slim venue index from an explicit public path (client-side).
 * Malformed rows are filtered out so callers always get a clean SlimVenue[];
 * a non-array payload yields [] so the map degrades to "no pins" rather than
 * throwing.
 *
 * Offline: a good load is mirrored to IndexedDB (fire-and-forget); if the
 * fetch itself fails, the last mirrored index for that path is returned
 * instead. Only when there is no fallback either does the original error
 * propagate — preserving the pre-offline contract for callers that show a
 * load-error state.
 */
export async function loadSlimVenuesFromPath(path: string): Promise<SlimVenue[]> {
  const offlineKey = offlineKeyForPath(path);
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    const rows = normalizeRows(data);
    if (rows.length > 0) void offlineCache.set(offlineKey, rows);
    return rows;
  } catch (error) {
    const stored = await offlineCache.get<unknown>(offlineKey);
    const fallback = normalizeRows(stored);
    if (fallback.length > 0) return fallback;
    throw error;
  }
}

/**
 * London default loader — same contract as before multi-city routing.
 */
export async function loadSlimVenues(): Promise<SlimVenue[]> {
  return loadSlimVenuesFromPath(SLIM_VENUES_PATH);
}

/**
 * City-aware slim loader. Uses CityConfig.slimVenuesPath so non-London maps
 * hit `/data/cities/{id}/venues_slim.json` without 404ing on London paths.
 */
export async function loadSlimVenuesForCity(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): Promise<SlimVenue[]> {
  const city = getCity(cityId);
  return loadSlimVenuesFromPath(city.slimVenuesPath);
}
