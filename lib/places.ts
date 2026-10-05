// Places policy: which cities a reader may pick, what each one may CLAIM about
// itself, and every sentence the Places tab prints.
//
// Pure by design, so the tab, its tests and any later surface read one answer.
// Nothing here derives a figure, a date or a coverage claim: prices come from
// lib/cityCapabilities.ts and areas from lib/nightAreas.ts, and where either has
// nothing the copy SAYS SO rather than leaving a blank that reads as none.
//
// The two honest gaps are separate findings with separate sentences. A city with
// no listed prices is not a city with no areas, and a reader who is told one
// while the other is true has been misled about which half is missing.

import type { Route } from "next";
import {
  buildCityChooserSearchResults,
  TOWN_SEARCH_UNAVAILABLE_LEAD,
  type CityChooserSearchResult,
} from "@/lib/cityChooserSearch";
import { PLACES_PATH } from "@/lib/cityPickerRoute";
import {
  getCity,
  listEnabledCities,
  parseCityId,
  type CityId,
} from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import {
  normaliseUkPlaceQuery,
  type UkPlace,
  type UkPlaceIndexStatus,
} from "@/lib/ukPlaceSearch";
import {
  UK_NATIONAL_ENTRY_LABEL,
  UK_NATIONAL_MAP_HREF,
} from "@/lib/ukNationalBrowse";

export { PLACES_PATH };
const PLACES_CITY_PARAM = "city";

/** Kicker above the heading, per the shell's kicker-then-heading rhythm. */
export const PLACES_KICKER = "Places";
export const PLACES_TITLE = "Pick a city.";
export const PLACES_LEDE = "Set one and the map, Out and Near all open there.";

/**
 * The list screen's one painted action, and its one quiet way onward.
 *
 * The secondary is the national browse entry's OWN label
 * (UK_NATIONAL_ENTRY_LABEL), read rather than retyped, so the two doors onto
 * that map cannot start calling it two different things.
 */
export const PLACES_LIST_PRIMARY_LABEL = "Open London";
export const PLACES_LIST_SECONDARY_LABEL = UK_NATIONAL_ENTRY_LABEL;

/** The one way back to the full list while a query stands. */
export const PLACES_SHOW_ALL_LABEL = "Show every city";

export const PLACES_SEARCH_LABEL = "Find a city";
export const PLACES_SEARCH_PLACEHOLDER = "Search a city";

/** The one primary action a city panel offers. */
export const PLACES_SET_CITY_LABEL = "Set as my city";
/** What the panel says instead, once this city IS the reader's. */
export const PLACES_CURRENT_CITY_LABEL = "This is your city.";

export const PLACES_BACK_LABEL = "All cities";
export const PLACES_AREAS_KICKER = "Inside the city";

/**
 * The short mark on a city row.
 *
 * It reports the PRICES lane alone, because that is the one a reader is choosing
 * a city for. Areas are the panel's business, and a row carrying two marks makes
 * the list unreadable at 320px.
 */
export const PLACES_PRICES_LISTED_PILL = "Prices listed";
export const PLACES_PRICES_COMING_PILL = "Prices coming";
export const PLACES_AREAS_COMING_PILL = "Areas coming";

export type PlacesCityRow = {
  cityId: CityId;
  name: string;
  tagline: string;
  /** True only where the capability profile says prices are available. */
  pricesListed: boolean;
  /** The capability profile's own sentence about prices. Never re-worded here. */
  pricesLine: string;
  /** ISO collection date behind a listed price, or null when there is none. */
  pricesAsOf: string | null;
  areaCount: number;
};

/** Every city a reader may pick, in the shipped pack order. */
export function placesCityRows(): PlacesCityRow[] {
  return listEnabledCities().map((city) => {
    const prices = getCityCapabilityProfile(city.id).prices;
    return {
      cityId: city.id,
      name: city.displayName,
      tagline: city.tagline,
      pricesListed: prices.availability === "available",
      pricesLine: prices.explanation,
      pricesAsOf: prices.asOf,
      areaCount: getNightAreasForCity(city.id).length,
    };
  });
}

/** The pill one row wears. */
export function placesPricesPill(
  row: Pick<PlacesCityRow, "pricesListed">,
): string {
  return row.pricesListed
    ? PLACES_PRICES_LISTED_PILL
    : PLACES_PRICES_COMING_PILL;
}

function normalisePlacesQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function cityNameMatchesQuery(name: string, query: string): boolean {
  return ` ${normalisePlacesQuery(name)}`.includes(` ${query}`);
}

/**
 * Rows a typed query keeps.
 *
 * Names match from a word's start, so Chester does not match Manchester.
 * Taglines still answer queries such as "northern quarter" and "subway".
 * An empty query keeps every city.
 */
export function filterPlacesCityRows(
  rows: readonly PlacesCityRow[],
  query: string | null | undefined,
): PlacesCityRow[] {
  const needle = normalisePlacesQuery(query);
  if (!needle) return [...rows];
  return rows.filter((row) =>
    cityNameMatchesQuery(row.name, needle) || normalisePlacesQuery(row.tagline).includes(needle),
  );
}

/**
 * The towns behind a city search that matched nothing.
 *
 * The picker searches the cities we ship. A reader who types a town between
 * them typed a real place, and the retired /choose-city address answered one:
 * it read the UK place index and offered the base map where that town is. The
 * capability survives the move by falling back to the SAME policy that address
 * used, `buildCityChooserSearchResults`, so the two never drift into two
 * answers for one question.
 *
 * The fallback runs ONLY when the city rows come back empty. A query that
 * matched a city is already answered, and a second list under it would offer
 * the same night twice.
 */
export function placesTownResults(
  query: string,
  places: readonly UkPlace[],
): CityChooserSearchResult[] {
  const needle = normalisePlacesQuery(query);
  const cities = listEnabledCities().filter((city) => cityNameMatchesQuery(city.displayName, needle));
  return buildCityChooserSearchResults(query, cities, places);
}

/** True when a query has earned the town lookup: no city row, and enough typed. */
export function placesShouldSearchTowns(
  shownCityCount: number,
  query: string,
): boolean {
  return shownCityCount === 0 && normaliseUkPlaceQuery(query).length >= 2;
}

/**
 * True while a town lookup this surface has already decided to run is still
 * unanswered.
 *
 * `idle` counts as pending, and that is the whole point. The read is asked for
 * from an effect, so the commit that first opens the gate still holds the index
 * at `idle`, and a picker that treated it as a finished read would print the
 * city-not-found line for that commit and then replace it with the answer. The
 * two states that END a lookup are the only two that stop it being pending.
 */
export function placesTownLookupPending(
  searchTowns: boolean,
  status: UkPlaceIndexStatus,
): boolean {
  return searchTowns && status !== "ready" && status !== "error";
}

/**
 * What the picker says when the place index will not answer.
 *
 * The chooser's own line ends "The five city maps are below", which is true
 * THERE: its full city list always renders under the search panel. Here the
 * list is filtered out while a query stands, so a reader told the maps are
 * below would be looking at a screen holding none. The lead is shared and this
 * surface finishes it by naming the button that brings its list back.
 */
export function placesTownSearchUnavailableLine(): string {
  return `${TOWN_SEARCH_UNAVAILABLE_LEAD} ${PLACES_SHOW_ALL_LABEL} to pick one.`;
}

/** The one line a search that matched nothing prints. */
export function placesSearchEmptyLine(query: string): string {
  const typed = query.trim();
  return typed
    ? `No city here called ${typed}. Try another name.`
    : "No cities to show.";
}

/** `?city=` is a closed id or nothing. An unknown value is the city list. */
export function parsePlacesCityParam(
  raw: string | null | undefined,
): CityId | null {
  return parseCityId(raw);
}

export function placesCityHref(cityId: CityId): Route {
  return `${PLACES_PATH}?${PLACES_CITY_PARAM}=${encodeURIComponent(cityId)}`;
}

/** What a city panel says about prices. The profile owns the words. */
export function placesPricesLine(cityId: CityId): string {
  return getCityCapabilityProfile(cityId).prices.explanation;
}

/** The areas inside a city, in catalogue order. */
export function placesAreasForCity(cityId: CityId): NightArea[] {
  return getNightAreasForCity(cityId);
}

/** The heading over a city's areas. */
export function placesAreasTitle(cityId: CityId): string {
  return `Where to drink in ${getCity(cityId).displayName}`;
}

/**
 * The sentence a city with no mapped areas prints.
 *
 * It names the gap and hands over the thing that IS there, because a city we
 * have not divided into patches still has every one of its pubs on the map.
 */
export function placesAreasEmptyLine(cityId: CityId): string {
  return `We haven't mapped areas in ${getCity(cityId).displayName} yet. The pubs are already on the map.`;
}

/** What the panel confirms once this city is the reader's. */
export function placesCurrentCityLine(cityId: CityId): string {
  return `The map, Out and Near now open on ${getCity(cityId).displayName}.`;
}

export const PLACES_LIST_SECONDARY_HREF = UK_NATIONAL_MAP_HREF;

export type PlacesWay = { href: Route; label: string };

/**
 * The two actions a city panel offers, in Screen order: the painted one first.
 *
 * A city that is NOT yet the reader's owes them the choice, so the painted
 * action sets it and the quiet one opens the map anyway. A city that already IS
 * theirs owes them the way in instead, and Out follows the same stored city, so
 * it is the quiet second.
 *
 * There is deliberately no third row of ways below. It printed "Open the map"
 * and "What's on" a second and third time under the head that already carried
 * them, and a screen that offers the same door twice reads as two doors.
 */
export function placesCityActions(
  mapHref: Route,
  isYours: boolean,
): { primary: PlacesWay | null; secondary: PlacesWay } {
  const map: PlacesWay = { href: mapHref, label: "Open the map" };
  const whatsOn: PlacesWay = { href: "/out", label: "What's on" };
  return isYours
    ? { primary: map, secondary: whatsOn }
    : { primary: null, secondary: map };
}
