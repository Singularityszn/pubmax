import { haversineKm } from "@/lib/haversine";
import {
  NIGHT_OUT_PLACE_CATEGORIES as CONTRACT_CATEGORIES,
  NIGHT_OUT_PLACE_JOBS as CONTRACT_JOBS,
  NIGHT_OUT_PLACE_MAX_AGE_HOURS,
  categoryForNightOutJob as contractCategoryForNightOutJob,
  isCurrentNightOutPlace as contractIsCurrentNightOutPlace,
  isNightOutPlaceJob as contractIsNightOutPlaceJob,
  isValidNightOutPlace as contractIsValidNightOutPlace,
  isValidNightOutPlaceSnapshot as contractIsValidNightOutPlaceSnapshot,
} from "@/lib/nightOutPlaceContract.mjs";

export const NIGHT_OUT_PLACE_CATEGORIES = CONTRACT_CATEGORIES;
export type NightOutPlaceCategory = (typeof NIGHT_OUT_PLACE_CATEGORIES)[number];

export const NIGHT_OUT_PLACE_JOBS = CONTRACT_JOBS;
export type NightOutPlaceJob = (typeof NIGHT_OUT_PLACE_JOBS)[number];

export { NIGHT_OUT_PLACE_MAX_AGE_HOURS };

export type NightOutPlace = {
  id: string;
  category: NightOutPlaceCategory;
  job: NightOutPlaceJob;
  name: string;
  description: string;
  address: string;
  area: string;
  location: { lat: number; lng: number };
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  expiresAt: string;
  discoveredVia: "exa" | "firecrawl";
  extractedVia: "firecrawl";
};

export type NightOutPlaceSnapshot = {
  version: 1;
  generatedAt: string;
  status: "published" | "empty";
  provenanceRegistryVersion: 1;
  places: NightOutPlace[];
};

export function isNightOutPlaceJob(value: string): value is NightOutPlaceJob {
  return contractIsNightOutPlaceJob(value);
}

export function categoryForNightOutJob(job: NightOutPlaceJob): NightOutPlaceCategory {
  return contractCategoryForNightOutJob(job) as NightOutPlaceCategory;
}

/**
 * Runtime row guard delegated to the same contract used by ingestion and the
 * build-time validator, so malformed rows cannot reach a deployed bundle.
 */
export function isValidNightOutPlace(value: unknown): value is NightOutPlace {
  return contractIsValidNightOutPlace(value);
}

export function isValidNightOutPlaceSnapshot(
  value: unknown,
): value is NightOutPlaceSnapshot {
  return contractIsValidNightOutPlaceSnapshot(value);
}

/** Future-dated and expired rows are never served, even if a stale artifact lands. */
export function isCurrentNightOutPlace(
  place: NightOutPlace,
  now: Date,
): boolean {
  return contractIsCurrentNightOutPlace(place, now);
}

export function placesForNightOutJob(
  places: readonly NightOutPlace[],
  options: {
    job: NightOutPlaceJob;
    lat: number;
    lng: number;
    radiusKm: number;
    limit: number;
    now: Date;
  },
): NightOutPlace[] {
  const category = categoryForNightOutJob(options.job);
  return places
    .filter(
      (place) =>
        place.job === options.job &&
        place.category === category &&
        isCurrentNightOutPlace(place, options.now),
    )
    .map((place) => ({
      place,
      distanceKm: haversineKm(
        [options.lng, options.lat],
        [place.location.lng, place.location.lat],
      ),
    }))
    .filter(({ distanceKm }) => distanceKm <= options.radiusKm)
    .sort(
      (a, b) =>
        a.distanceKm - b.distanceKm ||
        (a.place.name < b.place.name ? -1 : a.place.name > b.place.name ? 1 : 0),
    )
    .slice(0, options.limit)
    .map(({ place }) => place);
}
