// The Shoreditch coffee pilot as the map reads it: the hand-checked rows in
// `data/coffee_pilot/shoreditch.json` joined to the cafes they name on the
// London venue layer.
//
// PURE and browser-safe. `scripts/lib/coffeePilotRows.mjs` is the data gate
// that holds the file to its rules at build time; this module only reads what
// passed. Three rules ride with it:
//
// 1. A DRINK IS A FACT OF ITS OWN. Flat white, latte and matcha latte are three
//    prices, each with its own page and day. Nothing here folds them into one
//    "coffee" figure.
// 2. THE PILOT NEVER BECOMES PINT AUTHORITY. A cafe is a `venue-osm-` id, which
//    no price band, pin band, cheapest bucket or Pint Index reads.
// 3. AN ABSENT DRINK STAYS ABSENT. A cafe whose page did not state a matcha
//    latte has no matcha latte row, and no copy here says it costs nothing.

import { formatGbp } from "@/lib/formatGbp";
import type { LondonVenue } from "@/lib/londonVenueShards";
import type { ShardEntry } from "@/lib/slimShards";
import {
  COFFEE_PILOT_BOX,
  COFFEE_PILOT_DRINKS,
} from "@/scripts/lib/coffeePilotArea.mjs";

export type CoffeePilotDrink = (typeof COFFEE_PILOT_DRINKS)[number];

/** One named drink at one cafe, with the page that stated it and the day. */
export type CoffeePilotPrice = {
  drink: CoffeePilotDrink;
  priceGbp: number;
  sourceUrl: string;
  /** `YYYY-MM-DD`, the day a person read the page. */
  observedAt: string;
};

export type CoffeePilotRow = CoffeePilotPrice & { venueId: string };

/** Where the map's read of the pilot stands. */
export type CoffeePilotStatus = "idle" | "loading" | "ready" | "failed";

/** A pilot cafe on the map. `prices` is in COFFEE_PILOT_DRINKS order. */
export type CoffeePilotCafe = {
  id: string;
  name: string;
  /** OSM address, or "" when the layer has none. Never invented. */
  address: string;
  lat: number;
  lng: number;
  prices: CoffeePilotPrice[];
};

/** The London venue shards that can hold a pilot cafe. */
export function coffeePilotShards(shards: readonly ShardEntry[]): ShardEntry[] {
  return shards.filter((shard) => {
    const [west, south, east, north] = shard.bbox;
    return (
      east >= COFFEE_PILOT_BOX.lngMin &&
      west <= COFFEE_PILOT_BOX.lngMax &&
      north >= COFFEE_PILOT_BOX.latMin &&
      south <= COFFEE_PILOT_BOX.latMax
    );
  });
}

/**
 * Join the rows to the cafes they name. A row whose id is not a cafe on the
 * layer is dropped: the pin needs the layer's position and name, and a row
 * the layer cannot place is not one the map can honestly draw.
 */
export function coffeePilotCafes(
  rows: readonly CoffeePilotRow[],
  venues: readonly LondonVenue[],
): CoffeePilotCafe[] {
  const cafes = new Map<string, LondonVenue>();
  for (const venue of venues) {
    if (venue.kind === "cafe") cafes.set(venue.id, venue);
  }
  const byId = new Map<string, CoffeePilotCafe>();
  for (const row of rows) {
    const venue = cafes.get(row.venueId);
    if (!venue) continue;
    let cafe = byId.get(venue.id);
    if (!cafe) {
      cafe = {
        id: venue.id,
        name: venue.name,
        address: venue.address,
        lat: venue.lat,
        lng: venue.lng,
        prices: [],
      };
      byId.set(venue.id, cafe);
    }
    if (cafe.prices.some((price) => price.drink === row.drink)) continue;
    cafe.prices.push({
      drink: row.drink,
      priceGbp: row.priceGbp,
      sourceUrl: row.sourceUrl,
      observedAt: row.observedAt,
    });
  }
  for (const cafe of byId.values()) {
    cafe.prices.sort(
      (left, right) =>
        COFFEE_PILOT_DRINKS.indexOf(left.drink) - COFFEE_PILOT_DRINKS.indexOf(right.drink),
    );
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The figure a cafe's pin prints: its first drink in menu order, NAMED. A flat
 * white is the comparison the pilot was built for, so it leads wherever the
 * page stated one; a cafe that only listed a matcha latte says so rather than
 * borrowing a coffee it never priced.
 */
export function coffeePilotPinLabel(cafe: CoffeePilotCafe): string | null {
  const lead = cafe.prices[0];
  if (!lead) return null;
  return `${formatGbp(lead.priceGbp)} ${lead.drink}`;
}

/** The drink's name as a row heading: "Flat white". */
export function coffeePilotDrinkLabel(drink: CoffeePilotDrink): string {
  return drink.charAt(0).toUpperCase() + drink.slice(1);
}

/** The page's host, without `www.`, as the source a reader can recognise. */
function coffeePilotSourceHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
}

/** "3 October 2026" for a `YYYY-MM-DD` day, read as a calendar day in UTC. */
export function coffeePilotDay(observedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(observedAt);
  if (!match) return observedAt;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Listed on crosstown.co.uk, 3 October 2026". */
export function coffeePilotSourceLine(price: CoffeePilotPrice): string {
  return `Listed on ${coffeePilotSourceHost(price.sourceUrl)}, ${coffeePilotDay(price.observedAt)}`;
}

/** Pilot cafes as the map's `coffee-pilot` source. */
export function coffeePilotToGeoJSON(
  cafes: readonly CoffeePilotCafe[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: cafes.flatMap((cafe) => {
      const label = coffeePilotPinLabel(cafe);
      if (!label) return [];
      return [
        {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [cafe.lng, cafe.lat] },
          properties: { id: cafe.id, name: cafe.name, label },
        },
      ];
    }),
  };
}
