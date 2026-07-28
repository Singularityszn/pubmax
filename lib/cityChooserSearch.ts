import {
  enabledCityContainingPoint,
  type CityConfig,
  type CityId,
} from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";
import {
  normaliseUkPlaceQuery,
  searchUkPlaces,
  ukPlaceMapUrl,
  type UkPlace,
} from "@/lib/ukPlaceSearch";

export type CityChooserSearchResult =
  | {
      kind: "curated";
      name: string;
      description: string;
      href: string;
      cityId: CityId;
    }
  | {
      kind: "uncovered";
      name: string;
      description: string;
      href: string;
      context: string;
    };

const UNCOVERED_DESCRIPTION =
  "No prices logged here yet. Open the pub map and you could be first.";

export function buildCityChooserSearchResults(
  query: string,
  cities: readonly CityConfig[],
  places: readonly UkPlace[],
  limit = 8,
): CityChooserSearchResult[] {
  const normalizedQuery = normaliseUkPlaceQuery(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];
  const curated = cities
    .filter((city) =>
      normaliseUkPlaceQuery(city.displayName).includes(normalizedQuery),
    )
    .map(
      (city): CityChooserSearchResult => ({
        kind: "curated",
        name: city.displayName,
        description: city.tagline,
        href: cityMapShareUrl(city.id),
        cityId: city.id,
      }),
    );
  const routedCityIds = new Set<CityId>(
    curated.flatMap((result) =>
      result.kind === "curated" ? [result.cityId] : [],
    ),
  );
  const matched: CityChooserSearchResult[] = [];
  for (const place of searchUkPlaces(
    query,
    places,
    cities.map((city) => city.displayName),
    Math.max(0, limit - curated.length),
  )) {
    // A locality inside a curated city (Camden, Didsbury, Headingley) is that
    // city. It keeps the rich guide rather than being offered as uncovered.
    const city = enabledCityContainingPoint(place.lat, place.lng);
    if (!city) {
      matched.push({
        kind: "uncovered",
        name: place.name,
        description: UNCOVERED_DESCRIPTION,
        href: ukPlaceMapUrl(place),
        context: place.context,
      });
      continue;
    }
    if (routedCityIds.has(city.id)) continue;
    routedCityIds.add(city.id);
    matched.push({
      kind: "curated",
      name: place.name,
      description: `Part of the ${city.displayName} city guide, with prices and crawls.`,
      href: cityMapShareUrl(city.id),
      cityId: city.id,
    });
  }
  return [...curated, ...matched].slice(0, limit);
}
