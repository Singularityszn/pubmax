"use client";

import { listEnabledCities, type CityId } from "@/lib/cities";
import {
  buildMapSearchIndex,
  mapSearchPintRank,
  type MapSearchIndex,
  type MapSearchPack,
} from "@/lib/mapSearchIndex";
import {
  readSurfaceSnapshot,
  writeSurfaceSnapshot,
} from "@/lib/surfaceDataCache";
import {
  loadSlimVenuesForCityResult,
  type SlimVenue,
  type SlimVenueLoadResult,
} from "@/lib/venuesSlim";
import type { Venue } from "@/lib/venues";
import { venueAreaLabel } from "@/lib/venueDisplay";

// v3: venue names lost their operator suffix and carry `sourceName` for search.
// v4: a v3 snapshot could hold the current city as only the shards the map had
// loaded around the opening viewport, so it is not trusted.
// v5: preserve venue kinds so an indexed bar or restaurant names itself.
// v6 carries pint evidence so unloaded pubs use the same ranking as map shards.
const SEARCH_INDEX_CACHE_KEY = "map-search-index:v6";
const SEARCH_INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cachedIndex: MapSearchIndex | null = null;
let pendingIndex: Promise<MapSearchIndex> | null = null;

function isCompactIndex(
  value: unknown,
  expectedCities: readonly { id: CityId; displayName: string }[],
): value is MapSearchIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { cities?: unknown; venues?: unknown };
  const candidateCities = Array.isArray(candidate.cities)
    ? candidate.cities
    : null;
  const cityListMatches =
    candidateCities !== null &&
    candidateCities.length === expectedCities.length &&
    expectedCities.every((expected) =>
      candidateCities.some(
        (city) =>
          city &&
          typeof city === "object" &&
          (city as { id?: unknown }).id === expected.id &&
          (city as { name?: unknown }).name === expected.displayName,
      ),
    );
  return (
    cityListMatches &&
    Array.isArray(candidate.cities) &&
    candidate.cities.every(
      (city) =>
        city &&
        typeof city === "object" &&
        typeof (city as { id?: unknown }).id === "string" &&
        typeof (city as { name?: unknown }).name === "string",
    ) &&
    Array.isArray(candidate.venues) &&
    candidate.venues.every(
      (venue) =>
        venue &&
        typeof venue === "object" &&
        typeof (venue as { id?: unknown }).id === "string" &&
        typeof (venue as { name?: unknown }).name === "string" &&
        typeof (venue as { area?: unknown }).area === "string" &&
        typeof (venue as { cityId?: unknown }).cityId === "string" &&
        ((venue as { pintPrice?: unknown }).pintPrice === undefined ||
          (typeof (venue as { pintPrice?: unknown }).pintPrice === "number" &&
            Number.isFinite((venue as { pintPrice: number }).pintPrice) &&
            (venue as { pintPrice: number }).pintPrice > 0)),
    )
  );
}

function packFromSlim(cityId: CityId, venues: readonly SlimVenue[]): MapSearchPack {
  return {
    cityId,
    venues: venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      ...(venue.sourceName ? { sourceName: venue.sourceName } : {}),
      area: venueAreaLabel({ locality: venue.locality, primaryBorough: venue.borough }),
      ...(venue.kind !== undefined ? { venueKind: venue.kind } : {}),
      ...(mapSearchPintRank(venue.kind, venue.cheapestPrice) === 0
        ? { pintPrice: venue.cheapestPrice! } : {}),
    })),
  };
}

/**
 * The map reads only the shards around its viewport, so the venues it holds are
 * a slice of the city. The index answers for the whole city from its full pack,
 * and keeps any held venue the pack lacks.
 */
function packWithCurrentVenues(
  pack: MapSearchPack,
  venues: readonly (Pick<Venue, "id" | "name" | "sourceName" | "primaryBorough" | "locality" | "kind"> &
    Partial<Pick<Venue, "cheapestPrice" | "latestContributorPrice">>)[],
): MapSearchPack {
  const packIds = new Set(pack.venues.map((venue) => venue.id));
  return {
    cityId: pack.cityId,
    venues: [
      ...pack.venues,
      ...venues
        .filter((venue) => !packIds.has(venue.id))
        .map((venue) => ({
          id: venue.id,
          name: venue.name,
          ...(venue.sourceName ? { sourceName: venue.sourceName } : {}),
          area: venueAreaLabel(venue),
          ...(venue.kind !== undefined ? { venueKind: venue.kind } : {}),
          ...(mapSearchPintRank(venue.kind, venue.latestContributorPrice ?? venue.cheapestPrice) === 0
            ? { pintPrice: (venue.latestContributorPrice ?? venue.cheapestPrice)! } : {}),
        })),
    ],
  };
}

function loadCityPack(cityId: CityId): Promise<SlimVenueLoadResult> {
  return loadSlimVenuesForCityResult(cityId).catch(() => ({
    rows: [],
    status: "unavailable" as const,
  }));
}

export type MapSearchIndexLoadOptions = {
  currentCityId?: CityId;
  currentVenues?: readonly (Pick<Venue, "id" | "name" | "sourceName" | "primaryBorough" | "locality" | "kind"> &
    Partial<Pick<Venue, "cheapestPrice" | "latestContributorPrice">>)[];
};

/** Whether the index answers for every city, so a caller need not ask again. */
export function isCompleteMapSearchIndex(index: MapSearchIndex): boolean {
  return index === cachedIndex;
}

export function loadMapSearchIndex(
  options: MapSearchIndexLoadOptions = {},
): Promise<MapSearchIndex> {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (pendingIndex) return pendingIndex;

  const cities = listEnabledCities();
  const snapshot = readSurfaceSnapshot<MapSearchIndex>(
    SEARCH_INDEX_CACHE_KEY,
    SEARCH_INDEX_MAX_AGE_MS,
  );
  if (isCompactIndex(snapshot, cities)) {
    cachedIndex = snapshot;
    return Promise.resolve(snapshot);
  }

  const pending = Promise.all(
    cities.map(async (city) => {
      const result = await loadCityPack(city.id);
      const pack = packFromSlim(city.id, result.rows);
      return {
        complete: result.status === "ready",
        pack:
          city.id === options.currentCityId && options.currentVenues
            ? packWithCurrentVenues(pack, options.currentVenues)
            : pack,
      };
    }),
  )
    .then((loaded) => {
      const index = buildMapSearchIndex(
        cities.map((city) => ({ id: city.id, displayName: city.displayName })),
        loaded.map(({ pack }) => pack),
      );
      // A city whose pack did not load is answered for now and asked for again
      // on the next search (isCompleteMapSearchIndex is false), never kept as
      // the session's index.
      if (loaded.every(({ complete }) => complete)) {
        cachedIndex = index;
        writeSurfaceSnapshot(SEARCH_INDEX_CACHE_KEY, index);
      }
      return index;
    })
    .finally(() => {
      pendingIndex = null;
    });

  pendingIndex = pending;
  return pending;
}
