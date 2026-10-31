// UK city rivalry leaderboard — ranks cities by community energy, not fake
// price catalogues. Score = Pint Drops × 3 + curated crawl packs × 5 +
// min(venues, 200) / 10.
//
// REAL COUNTS OR NOTHING (launch review, 30 Oct 2026, item 10). The board used
// to score twelve cities from DEMO seed counts and printed "Seeded only where
// we've got demo data" on the live site. A demo count is never a drop count
// now: the snapshot takes REAL per-city counts from its caller, and
// `publishableCityRivalry` hands a page rows only when every city has a real
// count above zero. No real counter exists yet, so the board is empty and the
// Pubs and pints tab prints no section. The path stays for that counter.

import "server-only";

import { readFileSync } from "fs";
import path from "path";

import { CITIES, listEnabledCities, type CityId } from "@/lib/cities";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

export type CityRivalryEntry = {
  cityId: CityId;
  displayName: string;
  dropCount: number;
  crawlPackCount: number; // curated crawls shipped
  venueCount: number; // slim venues
  score: number; // drops*3 + crawls*5 + min(venues,200)/10
  tagline: string;
};

export type CityRivalryInput = {
  cityId: CityId;
  dropCount: number;
  crawlPackCount: number;
  venueCount: number;
  tagline: string;
  displayName?: string;
};

/** Weighted energy score — pure, testable. */
export function rivalryScore(input: {
  dropCount: number;
  crawlPackCount: number;
  venueCount: number;
}): number {
  const drops = Math.max(0, input.dropCount);
  const crawls = Math.max(0, input.crawlPackCount);
  const venues = Math.max(0, input.venueCount);
  return drops * 3 + crawls * 5 + Math.min(venues, 200) / 10;
}

/**
 * Rank injected city rows by score (desc), then display name.
 * Pure — no filesystem. Prefer this in unit tests.
 */
export function rankCities(input: CityRivalryInput[]): CityRivalryEntry[] {
  return input
    .map((row) => {
      const displayName = row.displayName ?? CITIES[row.cityId]?.displayName ?? row.cityId;
      return {
        cityId: row.cityId,
        displayName,
        dropCount: Math.max(0, row.dropCount),
        crawlPackCount: Math.max(0, row.crawlPackCount),
        venueCount: Math.max(0, row.venueCount),
        score: rivalryScore(row),
        tagline: row.tagline,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.displayName.localeCompare(b.displayName);
    });
}

/** Resolve slim JSON path on disk from a CityConfig.slimVenuesPath. */
export function slimVenuesDiskPath(slimVenuesPath: string): string {
  const rel = slimVenuesPath.replace(/^\//, "");
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    rel.replace(/^data\//, "data/"),
  );
}

/**
 * Count rows in a slim venues JSON array. Returns 0 on missing/malformed files.
 * Accepts an optional override map for tests (cityId → count).
 */
function countSlimVenues(
  cityId: CityId,
  overrides?: Partial<Record<CityId, number>>,
): number {
  if (overrides && cityId in overrides) {
    return overrides[cityId] ?? 0;
  }
  const city = CITIES[cityId];
  if (!city) return 0;
  try {
    const file = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "public",
      city.slimVenuesPath.replace(/^\//, ""),
    );
    const raw = readFileSync(
      /* turbopackIgnore: true */ file,
      "utf8",
    );
    return rowsFromSlimPayload(JSON.parse(raw))?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The board a public page may print: every row, when every city carries a
 * real Pint Drop count above zero, and otherwise nothing at all. A partial
 * board would rank cities on counts we do not hold.
 */
export function publishableCityRivalry(entries: readonly CityRivalryEntry[]): CityRivalryEntry[] {
  if (entries.length === 0) return [];
  return entries.every((entry) => Number.isFinite(entry.dropCount) && entry.dropCount > 0)
    ? [...entries]
    : [];
}

/**
 * Curated crawl packs actually shipped for a city. Browse-only cities
 * (e.g. Bath) return an empty catalog from `curatedCrawlsForCity`.
 */
export function crawlPackCountForCity(cityId: CityId): number {
  switch (cityId) {
    case "london":
    case "manchester":
    case "glasgow":
    case "liverpool":
    case "oxford":
    case "cambridge":
    case "durham":
    case "bristol":
      return curatedCrawlsForCity(cityId).length;
    default:
      return 0;
  }
}

/**
 * Build the publishable rivalry snapshot from REAL per-city Pint Drop counts,
 * curated crawl packs and slim venue lengths. A city missing from
 * `realDropCounts` counts zero, so the board stays empty until a real counter
 * supplies every city. Optional venueOverrides keep Node filesystem out of tests.
 */
export function buildCityRivalrySnapshot(
  venueOverrides?: Partial<Record<CityId, number>>,
  realDropCounts: Partial<Record<CityId, number>> = {},
): CityRivalryEntry[] {
  const rows: CityRivalryInput[] = listEnabledCities().map((city) => ({
    cityId: city.id,
    displayName: city.displayName,
    dropCount: realDropCounts[city.id] ?? 0,
    crawlPackCount: crawlPackCountForCity(city.id),
    venueCount: countSlimVenues(city.id, venueOverrides),
    tagline: city.tagline,
  }));
  return publishableCityRivalry(rankCities(rows));
}

/** Alias matching the product brief. */
export function cityRivalryLeaderboard(
  venueOverrides?: Partial<Record<CityId, number>>,
  realDropCounts?: Partial<Record<CityId, number>>,
): CityRivalryEntry[] {
  return buildCityRivalrySnapshot(venueOverrides, realDropCounts);
}
