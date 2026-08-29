import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { getCity, listEnabledCities, type CityId } from "@/lib/cities";
import {
  cityIdFromVenueId,
  unresolvedVenueLabel,
  venueCityPrefix,
} from "@/lib/cityVenueIds";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { matchVenuePermalinkSlug } from "@/lib/venuePermalinkSlug";
import { isVenueKind, type Venue, type VenueKind } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";
import { canonicalOsmId } from "@/lib/harvestFold";
import { cityVenueIdForPub } from "@/lib/cityVenueId.mjs";
import { UK_OSM_PUBS_FILE } from "@/lib/ukOsmPubsFile.mjs";
import { outerLondonOwnerForPub } from "@/lib/outerLondonOwnership.mjs";

// Server-only venue-name resolution (PRD §9). Social content stores raw venue
// ids (content-hashed, e.g. "venue-1ufn31x"); no public feed/profile/permalink
// card should ever show that id as the venue label. This module turns an id into
// a { name, borough, lat, lng } ref so server routes can enrich their DTOs with
// a real pub name + a "open on the map" link before the client renders them.
//
// It reads the SLIM index (~400 KB) with `fs` — so import it ONLY from server
// code (route handlers, server components, generateMetadata). Client components
// get the resolved name through the API response, never by importing this file.

export type VenueRef = {
  id: string;
  name: string;
  borough: string;
  lat: number;
  lng: number;
  kind?: VenueKind;
  osmId?: string;
};

export type CanonicalVenueLookup =
  | {
      status: "found";
      canonicalId: string;
      venue: VenueRef;
      slimVenue: SlimVenue;
    }
  | { status: "unknown"; canonicalId: string }
  | { status: "unavailable"; canonicalId: string };

type SlimRow = {
  id?: unknown;
  name?: unknown;
  borough?: unknown;
  lat?: unknown;
  lng?: unknown;
  cheapestPrice?: unknown;
  kind?: unknown;
  [key: string]: unknown;
};

type IndexedVenue = {
  venue: VenueRef;
  slimVenue: SlimVenue;
};

export type VenueIndexSnapshot = {
  index: Map<string, VenueRef>;
  loadedCities: ReadonlySet<CityId>;
  complete: boolean;
};

// Pure: fold venues into an id→ref lookup. Split out so it's unit-testable
// with small fixtures instead of the full dataset.
export function buildVenueIndex(venues: Venue[]): Map<string, VenueRef> {
  const index = new Map<string, VenueRef>();
  for (const v of venues) {
    index.set(v.id, {
      id: v.id,
      name: v.name,
      borough: v.primaryBorough || "London",
      lat: v.latitude,
      lng: v.longitude,
      ...(v.kind !== undefined ? { kind: v.kind } : {}),
    });
  }
  return index;
}

function buildVenueIndexFromSlim(rows: SlimRow[]): Map<string, IndexedVenue> {
  const index = new Map<string, IndexedVenue>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (typeof row.name !== "string" || !row.name) continue;
    if (row.kind !== undefined && !isVenueKind(row.kind)) continue;
    const lat = typeof row.lat === "number" ? row.lat : Number(row.lat);
    const lng = typeof row.lng === "number" ? row.lng : Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const borough =
      typeof row.borough === "string" && row.borough ? row.borough : "London";
    const venue: VenueRef = {
      id: row.id,
      name: row.name,
      borough,
      lat,
      lng,
      ...(row.kind !== undefined ? { kind: row.kind as VenueKind } : {}),
    };
    const cheapestPrice =
      row.cheapestPrice === null ||
      (typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice))
        ? row.cheapestPrice
        : null;
    const slimVenue: SlimVenue = {
      id: row.id,
      name: row.name,
      borough,
      lat,
      lng,
      cheapestPrice,
      ...(typeof row.zone === "number" &&
      Number.isInteger(row.zone) &&
      row.zone > 0
        ? { zone: row.zone }
        : {}),
      ...(typeof row.filterHints === "object" && row.filterHints !== null
        ? { filterHints: row.filterHints as SlimVenue["filterHints"] }
        : {}),
      ...(row.kind !== undefined ? { kind: row.kind as VenueKind } : {}),
      ...(row.priceBand === 0 || row.priceBand === 1 || row.priceBand === 2
        ? { priceBand: row.priceBand }
        : {}),
      ...(typeof row.anchorLabel === "string"
        ? { anchorLabel: row.anchorLabel }
        : {}),
      ...(typeof row.anchorCourse === "string"
        ? { anchorCourse: row.anchorCourse as SlimVenue["anchorCourse"] }
        : {}),
      ...(typeof row.anchorObservedAt === "string"
        ? { anchorObservedAt: row.anchorObservedAt }
        : {}),
      ...(typeof row.anchorSourceUrl === "string"
        ? { anchorSourceUrl: row.anchorSourceUrl }
        : {}),
    };
    index.set(row.id, { venue, slimVenue });
  }
  return index;
}

let cached: Map<string, VenueRef> | null = null;
const cityCache = new Map<string, Map<string, IndexedVenue>>();
const cityOsmCache = new Map<string, Map<string, IndexedVenue>>();

function publicDataPath(publicPath: string): string {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    publicPath.replace(/^\//, ""),
  );
}

async function readSlimIndex(
  publicPath: string,
): Promise<Map<string, IndexedVenue>> {
  const rows = JSON.parse(
    await fs.readFile(
      /* turbopackIgnore: true */ publicDataPath(publicPath),
      "utf8",
    ),
  ) as SlimRow[];
  return buildVenueIndexFromSlim(Array.isArray(rows) ? rows : []);
}

async function attachCityOsmIds(
  cityId: string,
  index: Map<string, IndexedVenue>,
): Promise<boolean> {
  try {
    const sourcePath =
      cityId === "london"
        ? path.join(process.cwd(), UK_OSM_PUBS_FILE)
        : path.join(
            process.cwd(),
            "data",
            "cities",
            cityId,
            "osm_pubs.json",
          );
    const raw = await fs.readFile(
      /* turbopackIgnore: true */ sourcePath,
      "utf8",
    );
    const pubs = JSON.parse(raw)?.pubs;
    if (!Array.isArray(pubs)) return false;
    const londonVenues =
      cityId === "london"
        ? [...index.values()].map(({ venue }) => ({
            id: venue.id,
            name: venue.name,
            lat: venue.lat,
            lng: venue.lng,
          }))
        : [];
    for (const pub of pubs) {
      const venueId =
        cityId === "london"
          ? pub?.curatedRef?.source === "curated-london-slim" &&
            typeof pub.curatedRef.id === "string"
            ? pub.curatedRef.id
            : pub?.curatedRef?.source === "outer-london-osm-seed"
              ? outerLondonOwnerForPub(pub, londonVenues)
              : ""
          : cityVenueIdForPub(cityId, pub);
      const osmId = canonicalOsmId(pub?.osmId);
      if (!venueId || !osmId) continue;
      const entry = index.get(venueId);
      if (entry) entry.venue.osmId = osmId;
    }
    return true;
  } catch {
    return false;
  }
}

async function readCityVenueIndex(
  city: { id: string; slimVenuesPath: string },
): Promise<Map<string, IndexedVenue> | null> {
  const publicPath = city.slimVenuesPath;
  const existing = cityCache.get(publicPath);
  if (existing) return existing;
  try {
    const index = await readSlimIndex(publicPath);
    cityCache.set(publicPath, index);
    return index;
  } catch {
    return null;
  }
}

async function getCityVenueIndex(
  city: { id: string; slimVenuesPath: string },
): Promise<Map<string, IndexedVenue> | null> {
  const publicPath = city.slimVenuesPath;
  const existing = cityOsmCache.get(publicPath);
  if (existing) return existing;
  const baseIndex = await readCityVenueIndex(city);
  if (!baseIndex) return null;
  const index = new Map<string, IndexedVenue>();
  for (const [id, entry] of baseIndex) {
    index.set(id, { venue: { ...entry.venue }, slimVenue: entry.slimVenue });
  }
  if (!(await attachCityOsmIds(city.id, index))) return null;
  cityOsmCache.set(publicPath, index);
  return index;
}

// Read the slim index once and memoize. Never throws: a read/parse failure
// yields an empty index so name resolution degrades to the friendly fallback
// rather than 500-ing a page. Prefer venues_slim.json (~400 KB) over the full
// ~6 MB price dataset — name/borough/coords are all the social DTOs need.
//
// Per-city try/catch: one missing/corrupt city pack must not wipe London (or
// any other city that loaded). Each city's pack is cached individually, so a
// transient per-city read failure is retried on the next call instead of
// pinning a partial (or empty) index for the process lifetime; the merged map
// is only memoized once every enabled city has loaded.
export async function getVenueIndex(): Promise<Map<string, VenueRef>> {
  return (await getVenueIndexSnapshot()).index;
}

export async function getVenueIndexSnapshot(): Promise<VenueIndexSnapshot> {
  const cities = listEnabledCities();
  if (cached) {
    return {
      index: cached,
      loadedCities: new Set(cities.map((city) => city.id)),
      complete: true,
    };
  }
  let allLoaded = true;
  const loadedCities = new Set<CityId>();
  for (const city of cities) {
    if (await readCityVenueIndex(city)) loadedCities.add(city.id);
    else allLoaded = false;
  }
  const index = new Map<string, VenueRef>();
  for (const city of cities) {
    const cityIndex = cityCache.get(city.slimVenuesPath);
    if (!cityIndex) continue;
    for (const [id, entry] of cityIndex) {
      index.set(id, entry.venue);
    }
  }
  if (allLoaded) cached = index;
  return { index, loadedCities, complete: allLoaded };
}

async function lookupCanonicalVenueFromIndex(
  id: string,
  loadIndex: (
    city: { id: string; slimVenuesPath: string },
  ) => Promise<Map<string, IndexedVenue> | null>,
): Promise<CanonicalVenueLookup> {
  const canonicalId = await resolveCanonicalVenueId(id);
  const cityPrefix = venueCityPrefix(canonicalId);
  const cityId = cityIdFromVenueId(canonicalId);
  if (cityPrefix && !cityId) {
    return { status: "unknown", canonicalId };
  }
  const city = getCity(cityId);
  if (!city.enabled) {
    return { status: "unknown", canonicalId };
  }
  const cityIndex = await loadIndex(city);
  if (!cityIndex) {
    return { status: "unavailable", canonicalId };
  }
  const entry = cityIndex.get(canonicalId);
  return entry
    ? { status: "found", canonicalId, ...entry }
    : { status: "unknown", canonicalId };
}

export async function lookupCanonicalVenue(id: string): Promise<CanonicalVenueLookup> {
  return lookupCanonicalVenueFromIndex(id, readCityVenueIndex);
}

export async function lookupCanonicalVenueWithOsm(
  id: string,
): Promise<CanonicalVenueLookup> {
  return lookupCanonicalVenueFromIndex(id, getCityVenueIndex);
}

export async function resolveVenue(id: string): Promise<VenueRef | null> {
  if (!id) return null;
  const lookup = await lookupCanonicalVenue(id);
  return lookup.status === "found" ? lookup.venue : null;
}

/**
 * Resolve `/venue/:slug` and `/pub/:slug` permalinks. A durable venue id wins;
 * otherwise the slug must match exactly one name (+ optional postcode district)
 * key. Ambiguous or unknown slugs return null so the route can show the branded
 * 404 rather than guess a pub.
 */
export async function resolveVenuePermalinkSlug(
  slug: string,
): Promise<string | null> {
  if (!slug) return null;
  const byId = await getVenueIndex();
  if (byId.has(slug)) return slug;
  const canonical = await resolveCanonicalVenueId(slug);
  if (canonical !== slug && byId.has(canonical)) return canonical;

  const cities = listEnabledCities();
  const candidates: {
    id: string;
    name: string;
    searchText?: string;
  }[] = [];
  const candidateById = new Map<string, (typeof candidates)[number]>();
  for (const city of cities) {
    const cityIndex = await readCityVenueIndex(city);
    if (!cityIndex) continue;
    for (const { slimVenue } of cityIndex.values()) {
      const row = {
        id: slimVenue.id,
        name: slimVenue.name,
        ...(slimVenue.filterHints?.searchText
          ? { searchText: slimVenue.filterHints.searchText }
          : {}),
      };
      candidates.push(row);
      candidateById.set(row.id, row);
    }
  }
  return matchVenuePermalinkSlug(slug, candidates, candidateById);
}

// A display label that never surfaces a raw id: the pub name, or a friendly
// fallback for an id the dataset no longer carries.
export async function venueLabel(id: string): Promise<string> {
  return (await resolveVenue(id))?.name ?? unresolvedVenueLabel(id);
}

export { unresolvedVenueLabel } from "@/lib/cityVenueIds";

export function resetVenueIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    cityCache.clear();
    cityOsmCache.clear();
  }
}

// Re-export the client-safe helper so existing server imports keep working.
export { venueMapUrl } from "@/lib/venueMapUrl";
