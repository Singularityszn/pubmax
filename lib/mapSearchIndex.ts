import type { CityId } from "@/lib/cities";
import type { VenueKind } from "@/lib/venues";
import { isVerifiedClosedCuratedVenue } from "@/lib/verifiedClosedPubs";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type MapSearchCity = {
  id: CityId;
  name: string;
};

export type MapSearchCityInput = {
  id: CityId;
  displayName: string;
};

type MapSearchVenue = {
  id: string;
  name: string;
  /** The dataset's own name when it carries an operator suffix; matched, never shown. */
  sourceName?: string;
  area: string;
  venueKind?: VenueKind;
  /** A listed pint price, never a restaurant or cocktail anchor. */
  pintPrice?: number;
};

export type MapSearchPack = {
  cityId: CityId;
  venues: readonly MapSearchVenue[];
};

export type MapSearchIndex = {
  cities: readonly MapSearchCity[];
  venues: readonly MapSearchIndexVenue[];
};

type MapSearchIndexVenue = MapSearchVenue & {
  cityId: CityId;
};

export type MapSearchIndexResult =
  | MapSearchCityResult
  | MapSearchVenueResult;

type MapSearchCityResult = {
  kind: "city";
  id: CityId;
  name: string;
};

type MapSearchVenueResult = MapSearchIndexVenue & {
  kind: "venue";
};

const DEFAULT_RESULT_LIMIT = 12;

function normalise(value: string | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function hasOneMissingCharacter(query: string, value: string): boolean {
  if (query.length < 4 || value.length !== query.length + 1) return false;
  let queryIndex = 0;
  let skipped = false;
  for (const character of value) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
    }
  }
  return queryIndex === query.length;
}

export function mapSearchNameTier(labels: readonly string[], rawQuery: string): 0 | 1 | 2 | null {
  const query = normalise(rawQuery);
  if (!query) return null;
  let tier: 1 | 2 | null = null;
  for (const label of labels) {
    const name = normalise(label);
    if (!name) continue;
    if (name === query) return 0;
    if (name.startsWith(query) || words(name).some((word) => word.startsWith(query))) {
      tier = 1;
    } else if (query.length >= 2 && name.includes(query)) {
      tier ??= 2;
    }
  }
  return tier;
}

/** Lower score wins. */
function matchScore(query: string, names: readonly string[], area = ""): number | null {
  const nameTier = mapSearchNameTier(names, query);
  if (nameTier !== null) return nameTier;

  const normalisedArea = normalise(area);
  if (normalisedArea) {
    if (normalisedArea === query) return 3;
    if (normalisedArea.startsWith(query)) return 4;
    if (words(normalisedArea).some((word) => word.startsWith(query))) return 5;
    if (normalisedArea.includes(query)) return 6;
  }
  const normalisedNames = names.map(normalise).filter(Boolean);
  const compactQuery = query.replaceAll(" ", "");
  if (normalisedNames.some((name) => name.replaceAll(" ", "") === compactQuery)) return 7;
  if (normalisedNames.some((name) => words(name).some((word) => hasOneMissingCharacter(query, word)))) return 8;
  return null;
}

export function mapSearchVenueScore(venue: MapSearchVenue, rawQuery: string): number | null {
  const query = normalise(rawQuery);
  if (!query) return null;
  return matchScore(query, venueSearchNames(venue), venue.area);
}

export function mapSearchPintRank(kind: VenueKind | undefined, price: number | null | undefined): number {
  if (!isPubVenueKind(kind)) return 2;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? 0 : 1;
}

export function buildMapSearchIndex(
  cities: readonly MapSearchCityInput[],
  packs: readonly MapSearchPack[],
): MapSearchIndex {
  const knownCities = new Set(cities.map((city) => city.id));
  const venues: MapSearchIndexVenue[] = [];

  for (const pack of packs) {
    if (!knownCities.has(pack.cityId)) continue;
    for (const venue of pack.venues) {
      if (!venue.id || !venue.name || isVerifiedClosedCuratedVenue(venue.id)) continue;
      venues.push({
        id: venue.id,
        name: venue.name,
        ...(venue.sourceName ? { sourceName: venue.sourceName } : {}),
        area: venue.area ?? "",
        ...(venue.venueKind !== undefined ? { venueKind: venue.venueKind } : {}),
        ...(venue.pintPrice !== undefined ? { pintPrice: venue.pintPrice } : {}),
        cityId: pack.cityId,
      });
    }
  }

  return {
    cities: cities.map(({ id, displayName }) => ({ id, name: displayName })),
    venues,
  };
}

export function searchMapSearchIndex(
  index: MapSearchIndex,
  rawQuery: string,
  limit = DEFAULT_RESULT_LIMIT,
  options?: { preferPints: boolean; pintRankByVenueId?: ReadonlyMap<string, number> },
): MapSearchIndexResult[] {
  const query = normalise(rawQuery);
  if (!query || limit <= 0) return [];

  const candidates: Array<{ result: MapSearchIndexResult; score: number }> = [];
  for (const city of index.cities) {
    const score = matchScore(query, [city.name]);
    if (score !== null) {
      candidates.push({ result: { kind: "city", ...city }, score });
    }
  }
  for (const venue of index.venues) {
    const score = mapSearchVenueScore(venue, query);
    if (score !== null) {
      candidates.push({ result: { kind: "venue", ...venue }, score });
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.result.kind !== right.result.kind) {
        return left.result.kind === "city" ? -1 : 1;
      }
      if (options?.preferPints && left.result.kind === "venue" && right.result.kind === "venue") {
        const leftRank = options.pintRankByVenueId?.get(left.result.id) ??
          mapSearchPintRank(left.result.venueKind, left.result.pintPrice);
        const rightRank = options.pintRankByVenueId?.get(right.result.id) ??
          mapSearchPintRank(right.result.venueKind, right.result.pintPrice);
        const difference = leftRank - rightRank;
        if (difference !== 0) return difference;
      }
      return left.result.name.localeCompare(right.result.name, "en-GB");
    })
    .slice(0, limit)
    .map(({ result }) => result);
}
