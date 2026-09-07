"use client";

import { listEnabledCities, type CityId } from "@/lib/cities";
import {
  buildMapSearchIndex,
  type MapSearchIndex,
  type MapSearchPack,
} from "@/lib/mapSearchIndex";
import {
  readSurfaceSnapshot,
  writeSurfaceSnapshot,
} from "@/lib/surfaceDataCache";
import { loadSlimVenuesForCityResult, type SlimVenue } from "@/lib/venuesSlim";

const SEARCH_INDEX_CACHE_KEY = "map-search-index:v2";
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
        typeof (venue as { cityId?: unknown }).cityId === "string",
    )
  );
}

function packFromSlim(cityId: CityId, venues: readonly SlimVenue[]): MapSearchPack {
  return {
    cityId,
    venues: venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      area: venue.borough ?? "",
    })),
  };
}

export function loadMapSearchIndex(): Promise<MapSearchIndex> {
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
      const result = await loadSlimVenuesForCityResult(city.id);
      if (result.status !== "ready") {
        throw new Error(`Search venues could not load for ${city.displayName}.`);
      }
      return packFromSlim(city.id, result.rows);
    }),
  )
    .then((packs) => {
      const index = buildMapSearchIndex(
        cities.map((city) => ({ id: city.id, displayName: city.displayName })),
        packs,
      );
      cachedIndex = index;
      writeSurfaceSnapshot(SEARCH_INDEX_CACHE_KEY, index);
      return index;
    })
    .finally(() => {
      pendingIndex = null;
    });

  pendingIndex = pending;
  return pending;
}
