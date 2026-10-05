// The London restaurants the map draws: every `restaurant` row of the London
// venue layer, read from the one-file pack
// (`scripts/build_london_restaurant_pack.mjs`,
// `public/data/london_restaurants/restaurants.json`).
//
// A row is on that layer only when it serves alcohol: OpenStreetMap tags it
// with a bar or alcohol, or the restaurant's own website says so
// (`data/london_restaurant_drinks/`). Its name, address and position are
// OpenStreetMap's.
//
// PURE and browser-safe, apart from `loadLondonRestaurants`, which fetches.
// Four rules ride with it:
//
// 1. NO PRICE. A restaurant here is a `venue-osm-` id, which no price band,
//    pin band, cheapest bucket or Pint Index reads, and its feature carries no
//    price property for the pin colour to find.
// 2. A CURATED VENUE OWNS ITS OWN PLACE. The curated index already pins some
//    of these restaurants (Rules, Quo Vadis, The Wolseley). The OSM row beside
//    one is dropped rather than drawn as a second fork a few metres away.
// 3. THE KIND FILTER AND THE VIEW DECIDE, as they do for a curated restaurant.
//    Restaurants hidden in the filter, or a view that is not about restaurants,
//    take this layer off the map.
// 4. THE MAP'S FILTERS NARROW IT TOO. The search matches a name or address, and
//    near me keeps the restaurants inside its walk ring. A filter that asks what
//    a row cannot answer (a price, Open now, Saved only, an amenity, a drink, a
//    zone) hides every restaurant while it is on.

import { haversineMeters } from "@/lib/greatCircle.mjs";
import {
  isLondonVenueId,
  parseLondonVenueShard,
  type LondonVenue,
} from "@/lib/londonVenueShards";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import { NO_PINT_PRICE_CAP, type Filters } from "@/lib/venues";
import { parseZoneParam } from "@/lib/zones";

export const LONDON_RESTAURANT_PACK_PATH = "/data/london_restaurants/restaurants.json";
const LONDON_RESTAURANT_PACK_VERSION = 1;

/**
 * The zoom the layer draws from, and the zoom the map first asks for the pack
 * at. The same floor as every unclustered pin layer (`PIN_MIN_ZOOM` in
 * components/map/canvas/buildScene.ts, held equal by
 * __tests__/londonRestaurants.test.ts). It lives here so the map shell can
 * read it without loading the canvas module.
 */
export const LONDON_RESTAURANT_MIN_ZOOM = 12;

/**
 * Whether the map should read the pack now. The layer must be shown and the
 * priced pins must have painted (lib/mapFirstPinStreams.ts). The camera must
 * also be at the zoom the layer draws from, unless a restaurant is selected,
 * because a shared `?sel=` link must open its sheet wherever the camera is.
 * A selection the coffee pilot already places is a cafe, not a restaurant.
 */
export function londonRestaurantPackWanted(input: {
  shown: boolean;
  held: boolean;
  zoom: number;
  selectedVenueId: string;
  selectedIsCafe: boolean;
}): boolean {
  if (!input.shown || input.held) return false;
  return (
    input.zoom >= LONDON_RESTAURANT_MIN_ZOOM ||
    (isLondonVenueId(input.selectedVenueId) && !input.selectedIsCafe)
  );
}

/** Where the map's read of the pack stands. */
export type LondonRestaurantStatus = "idle" | "loading" | "ready" | "failed";

/**
 * Decode the pack. Null when the body is not the pack this build reads, or
 * when a row failed to decode: a pack that lost rows would hide restaurants
 * with nothing saying so.
 */
export function parseLondonRestaurantPack(value: unknown): LondonVenue[] | null {
  if (typeof value !== "object" || value === null) return null;
  const pack = value as Record<string, unknown>;
  if (
    pack.version !== LONDON_RESTAURANT_PACK_VERSION ||
    pack.kind !== "restaurant" ||
    !Array.isArray(pack.venues) ||
    pack.count !== pack.venues.length
  ) {
    return null;
  }
  const venues = parseLondonVenueShard(pack);
  if (venues.length !== pack.venues.length) return null;
  return venues.every((venue) => venue.kind === "restaurant") ? venues : null;
}

/** Read the pack. Rejects when it cannot be read or does not decode. */
export async function loadLondonRestaurants(
  fetchImpl: typeof fetch = fetch,
): Promise<LondonVenue[]> {
  const response = await fetchImpl(LONDON_RESTAURANT_PACK_PATH);
  if (!response.ok) {
    throw new Error(`${LONDON_RESTAURANT_PACK_PATH} answered ${response.status}`);
  }
  const restaurants = parseLondonRestaurantPack(await response.json());
  if (!restaurants) throw new Error("London restaurant pack is malformed");
  return restaurants;
}

/**
 * How far apart a curated venue and an OSM restaurant of the same name may sit
 * and still be one place. The curated index and OSM disagree by up to about
 * 50 m on the same door (Le Bab Soho), and two different restaurants that share
 * a name are rarely this close.
 */
const CURATED_TWIN_RADIUS_M = 75;

/** A curated venue as the twin check reads it: the `Venue` fields it needs. */
type PlacedName = { name: string; latitude: number; longitude: number };

/** Lowercase words, `&` read as "and", accents and a leading "the" dropped. */
function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && word !== "the");
}

/** One name holds every word of the other, so "Dishoom" matches "Dishoom Covent Garden". */
function namesMatch(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const words = new Set(longer);
  return shorter.every((word) => words.has(word));
}

/** A grid of about 220 m by 210 m in London, so a twin is looked for nearby only. */
const TWIN_CELL_LAT = 0.002;
const TWIN_CELL_LNG = 0.003;

function twinCell(lat: number, lng: number): [number, number] {
  return [Math.floor(lat / TWIN_CELL_LAT), Math.floor(lng / TWIN_CELL_LNG)];
}

/**
 * The restaurants with no curated twin. A curated venue of any kind counts,
 * because the curated index files some restaurants as late food, bars or pubs.
 */
export function londonRestaurantsWithoutCuratedTwin(
  restaurants: readonly LondonVenue[],
  curated: readonly PlacedName[],
): LondonVenue[] {
  if (curated.length === 0) return [...restaurants];
  const cells = new Map<string, { venue: PlacedName; tokens: string[] }[]>();
  for (const venue of curated) {
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) continue;
    const key = twinCell(venue.latitude, venue.longitude).join(":");
    const bucket = cells.get(key) ?? [];
    bucket.push({ venue, tokens: tokensOf(venue.name) });
    cells.set(key, bucket);
  }
  return restaurants.filter((restaurant) => {
    const [latCell, lngCell] = twinCell(restaurant.lat, restaurant.lng);
    let tokens: string[] | null = null;
    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLng = -1; dLng <= 1; dLng += 1) {
        for (const { venue, tokens: curatedTokens } of cells.get(
          `${latCell + dLat}:${lngCell + dLng}`,
        ) ?? []) {
          if (
            haversineMeters(restaurant.lat, restaurant.lng, venue.latitude, venue.longitude) >
            CURATED_TWIN_RADIUS_M
          ) {
            continue;
          }
          tokens ??= tokensOf(restaurant.name);
          if (namesMatch(tokens, curatedTokens)) return false;
        }
      }
    }
    return true;
  });
}

/**
 * Whether the map shows this layer. London only, because the pack is London's.
 * Restaurants must be on in the kind filter. A drink lane or a view owns the
 * map otherwise, and this layer has no price for one to read, except the food
 * view, which is the question a restaurant answers.
 */
export function londonRestaurantLayerShown(input: {
  isLondon: boolean;
  restaurantKindVisible: boolean;
  experienceLens: MapExperienceLens;
  /** A drink lane or a view is painting the map from its own prices. */
  lensOwnsMap: boolean;
}): boolean {
  if (!input.isLondon || !input.restaurantKindVisible) return false;
  return input.experienceLens === "food" || !input.lensOwnsMap;
}

/**
 * Whether a map filter asks a question a restaurant row cannot answer. A row
 * holds a name, an address and a position, and a restaurant serves food, so
 * only the search and the food filter can pass it.
 */
function filtersAskBeyondARestaurantRow(filters: Filters): boolean {
  const zone = parseZoneParam(filters.zone);
  return (
    filters.maxPrice < NO_PINT_PRICE_CAP ||
    (zone !== null && zone !== "all") ||
    filters.openNow ||
    filters.canonicalOnly ||
    filters.requirePintDrops ||
    filters.requireBeerGarden ||
    filters.requireNonAlcoholic ||
    filters.requireLiveSports ||
    filters.requireCocktails ||
    filters.requireWater ||
    filters.requireHeritage ||
    filters.requireStepFree ||
    filters.requireAccessibleToilet ||
    filters.requireSeatedService ||
    filters.drinkCategory.trim() !== "" ||
    filters.drinkBrand.trim() !== "" ||
    filters.topShelfOnly
  );
}

/**
 * The restaurants the map's own filters let through, as curated pins are let
 * through. Saved only keeps places a reader chose, and no restaurant can be
 * saved. Near me keeps the restaurants inside the walk ring the sheet names;
 * the nearest-few top-up for a thin area is the curated pins' alone. The
 * selected restaurant stays, as a selected curated pin does.
 */
export function londonRestaurantsPassingMapFilters(
  restaurants: readonly LondonVenue[],
  input: {
    filters: Filters;
    savedOnly: boolean;
    nearMe: { location: { lat: number; lng: number }; radiusKm: number } | null;
    selectedVenueId: string;
  },
): readonly LondonVenue[] {
  const query = input.filters.query.trim().toLowerCase();
  const nearMe = input.nearMe;
  const nothingPasses = input.savedOnly || filtersAskBeyondARestaurantRow(input.filters);
  if (!nothingPasses && !query && !nearMe) return restaurants;
  return restaurants.filter(
    (restaurant) =>
      restaurant.id === input.selectedVenueId ||
      (!nothingPasses &&
        (restaurant.name.toLowerCase().includes(query) ||
          restaurant.address.toLowerCase().includes(query)) &&
        (!nearMe ||
          haversineMeters(nearMe.location.lat, nearMe.location.lng, restaurant.lat, restaurant.lng) <=
            nearMe.radiusKm * 1000)),
  );
}

/** Restaurants as the map's `london-restaurants` source. Points only, no price. */
export function londonRestaurantsToGeoJSON(
  restaurants: readonly LondonVenue[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: restaurants.map((restaurant) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [restaurant.lng, restaurant.lat] },
      properties: { id: restaurant.id, name: restaurant.name },
    })),
  };
}
