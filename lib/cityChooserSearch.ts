import type { Route } from "next";
import {
  enabledCityContainingPoint,
  type CityConfig,
  type CityId,
} from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
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
      href: Route;
      cityId: CityId;
      /** Navigation point — city map centre, or the matched place inside it. */
      lat: number;
      lng: number;
    }
  | {
      kind: "uncovered";
      name: string;
      description: string;
      href: Route;
      context: string;
      lat: number;
      lng: number;
    };

const UNCOVERED_DESCRIPTION =
  "No prices logged here yet. Open the pub map and you could be first.";

/**
 * The badge one result wears, and the line a surface prints while it reads the
 * place index.
 *
 * Both surfaces that render a `CityChooserSearchResult` read these, because the
 * words belong to the RESULT KIND rather than to the page showing it: a second
 * copy beside the second caller lets one surface be reworded and not the other.
 */
export function cityChooserResultBadge(
  kind: CityChooserSearchResult["kind"],
): string {
  return kind === "curated" ? "City guide" : "No prices yet";
}

/**
 * The postcode area that tells two places of one name apart, or null.
 *
 * The index holds 294 names more than once: two Alresfords, three Ashes. A row
 * printing the name, the kind and the same uncovered sentence as the row above
 * it asks a reader to pick between two identical answers, and the one they take
 * can be a map hundreds of miles from the town they meant. `context` is the
 * field the index carries for exactly this, so the decision of when a result
 * HAS one lives here beside the badge, and each surface paints it in its own
 * ink. A curated result needs none: its description names the city it belongs
 * to, which is what tells it from its namesake.
 */
export function cityChooserResultContext(
  result: CityChooserSearchResult,
): string | null {
  return result.kind === "uncovered" && result.context ? result.context : null;
}

export const PLACE_INDEX_PENDING_LINE = "Looking across the UK pub map…";

/**
 * What a failed place-index read says, before a surface names its own way back.
 *
 * The lead is the only half that travels: what is on screen under it differs by
 * surface, so each one finishes the sentence about the list IT still shows.
 */
export const TOWN_SEARCH_UNAVAILABLE_LEAD =
  "Town search isn’t available right now.";

/**
 * What a place inside a curated city gets by being part of it. The line names
 * only what that city actually ships: a pack that is the map and nothing else
 * says so, because promising prices and crawls to somebody who taps through to
 * neither is a broken destination rather than a warm welcome.
 */
function cityGuideMembershipLine(city: CityConfig): string {
  const profile = getCityCapabilityProfile(city.id);
  const has: string[] = [];
  if (profile.prices.availability === "available") has.push("prices");
  if (profile.routes.availability === "available") has.push("crawls");
  const guide = `Part of the ${city.displayName} city guide`;
  return has.length > 0 ? `${guide}, with ${has.join(" and ")}.` : `${guide}.`;
}

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
    .map((city): CityChooserSearchResult => {
      const [lng, lat] = city.mapView.center;
      return {
        kind: "curated",
        name: city.displayName,
        description: city.tagline,
        href: cityMapShareUrl(city.id),
        cityId: city.id,
        lat,
        lng,
      };
    });
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
        lat: place.lat,
        lng: place.lng,
      });
      continue;
    }
    if (routedCityIds.has(city.id)) continue;
    routedCityIds.add(city.id);
    matched.push({
      kind: "curated",
      name: place.name,
      description: cityGuideMembershipLine(city),
      href: cityMapShareUrl(city.id),
      cityId: city.id,
      lat: place.lat,
      lng: place.lng,
    });
  }
  return [...curated, ...matched].slice(0, limit);
}
