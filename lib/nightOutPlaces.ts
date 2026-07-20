import { haversineKm } from "@/lib/haversine";
import { isSlopDescription } from "@/lib/slopFilter";

export const NIGHT_OUT_PLACE_CATEGORIES = ["restaurant", "attraction"] as const;
export type NightOutPlaceCategory = (typeof NIGHT_OUT_PLACE_CATEGORIES)[number];

export const NIGHT_OUT_PLACE_JOBS = [
  "near_pub_food",
  "pre_pub_attraction",
] as const;
export type NightOutPlaceJob = (typeof NIGHT_OUT_PLACE_JOBS)[number];

export const NIGHT_OUT_PLACE_MAX_AGE_HOURS = 24 * 30;

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

const LON_MIN = -0.55;
const LON_MAX = 0.3;
const LAT_MIN = 51.26;
const LAT_MAX = 51.72;

const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const iso = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function isCleanHttpsUrl(value: unknown): value is string {
  if (!text(value, 2_000)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      host !== "localhost" &&
      !host.endsWith(".local") &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
}

function isLondonLocation(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) return false;
  const location = value as Record<string, unknown>;
  return (
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= LAT_MIN &&
    location.lat <= LAT_MAX &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= LON_MIN &&
    location.lng <= LON_MAX
  );
}

export function isNightOutPlaceJob(value: string): value is NightOutPlaceJob {
  return (NIGHT_OUT_PLACE_JOBS as readonly string[]).includes(value);
}

export function categoryForNightOutJob(job: NightOutPlaceJob): NightOutPlaceCategory {
  return job === "near_pub_food" ? "restaurant" : "attraction";
}

/**
 * Runtime row guard shared by the loader and tests. The build-time validator
 * mirrors this contract so malformed rows cannot reach a deployed bundle.
 */
export function isValidNightOutPlace(value: unknown): value is NightOutPlace {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!text(row.id, 120) || !text(row.name, 160)) return false;
  if (!NIGHT_OUT_PLACE_CATEGORIES.includes(row.category as NightOutPlaceCategory)) {
    return false;
  }
  if (!NIGHT_OUT_PLACE_JOBS.includes(row.job as NightOutPlaceJob)) return false;
  if (categoryForNightOutJob(row.job as NightOutPlaceJob) !== row.category) return false;
  if (!text(row.description, 600) || isSlopDescription(row.description)) return false;
  if (!text(row.address, 300) || !text(row.area, 120)) return false;
  if (!isLondonLocation(row.location)) return false;
  if (!isCleanHttpsUrl(row.sourceUrl) || !text(row.sourceName, 160)) return false;
  if (new URL(row.sourceUrl).hostname.replace(/^www\./, "") !== row.sourceName) return false;
  if (!iso(row.observedAt) || !iso(row.expiresAt)) return false;
  if (Date.parse(row.expiresAt) <= Date.parse(row.observedAt)) return false;
  if (!(["exa", "firecrawl"] as const).includes(row.discoveredVia as "exa" | "firecrawl")) {
    return false;
  }
  return row.extractedVia === "firecrawl";
}

export function isValidNightOutPlaceSnapshot(
  value: unknown,
): value is NightOutPlaceSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    snapshot.provenanceRegistryVersion !== 1 ||
    !iso(snapshot.generatedAt) ||
    !["published", "empty"].includes(String(snapshot.status)) ||
    !Array.isArray(snapshot.places)
  ) {
    return false;
  }
  if (snapshot.status === "empty" && snapshot.places.length !== 0) return false;
  if (snapshot.status === "published" && snapshot.places.length === 0) return false;
  const ids = new Set<string>();
  for (const row of snapshot.places) {
    if (!isValidNightOutPlace(row) || ids.has(row.id)) return false;
    if (Date.parse(row.observedAt) > Date.parse(snapshot.generatedAt)) return false;
    ids.add(row.id);
  }
  return true;
}

/** Future-dated and expired rows are never served, even if a stale artifact lands. */
export function isCurrentNightOutPlace(
  place: NightOutPlace,
  now: Date,
): boolean {
  const nowMs = now.getTime();
  const observedMs = Date.parse(place.observedAt);
  const expiresMs = Date.parse(place.expiresAt);
  if (!Number.isFinite(observedMs) || !Number.isFinite(expiresMs)) return false;
  if (observedMs > nowMs || expiresMs <= nowMs) return false;
  return nowMs - observedMs <= NIGHT_OUT_PLACE_MAX_AGE_HOURS * 3_600_000;
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
