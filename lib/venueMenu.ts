import { venueDrinkMenu } from "@/lib/drinkMenu";
import {
  applyDrinkPriceUpdatesToMenu,
  type DrinkPriceUpdate,
} from "@/lib/drinkPriceUpdates";
import type { Drink } from "@/lib/drinks";
import {
  venueCoordsGroupingKey,
  venueGroupingKey,
  type Venue,
} from "@/lib/venues";

// The seam between the venue sheet (VenueInspector) and the all-drinks menu
// (lib/drinkMenu.ts). Venue.prices (VenuePrice[]) structurally satisfies
// LegacyPintPrice[] — app_price_id, pint_name, price_gbp all line up — so no
// mapping is needed here, just composition.
//
// The observed drink-price updates (public/data/drink_price_updates/latest.json,
// ~2 MB) are NOT imported here: a static import bundled the whole file into the
// map's client JS. GET /api/venue/[id] scopes them to one pub
// (lib/priceUpdates.server.ts) and the Drinks tab passes that venue's own rows
// in (lib/venuePriceUpdates.ts); the menu renders seed/app-dataset rows until
// the detail lands.

function applyDrinkUpdatesForKeys(
  base: Drink[],
  keys: string[],
  updates: DrinkPriceUpdate[],
): Drink[] {
  const canonical = keys[0];
  if (canonical === undefined) return base;
  const keySet = new Set(keys);
  const scoped = updates.filter((u) => keySet.has(u.venueKey));
  if (scoped.length === 0) return base;
  // Legacy alias observations retain their established canonical rating refs.
  // An explicit ID stays bound to the original validated source row.
  const menuUpdates = scoped.map((u) =>
    u.venueKey === canonical || u.itemId !== undefined ? u : { ...u, venueKey: canonical },
  );
  return applyDrinkPriceUpdatesToMenu(canonical, base, menuUpdates, keys);
}

export function venueMenuForInspector(
  venue: VenueMenuVenue,
  updates: DrinkPriceUpdate[] = [],
): Drink[] {
  const base = venueDrinkMenu(venue.id, venue.prices);
  return applyDrinkUpdatesForKeys(base, venueMenuLookupKeys(venue), updates);
}

export type VenueMenuVenue = Pick<Venue, "id" | "prices"> &
  Partial<
    Pick<
      Venue,
      | "name"
      | "sourceName"
      | "address"
      | "latitude"
      | "longitude"
      | "kind"
      | "cheapestPrice"
      | "anchorLabel"
      | "anchorCourse"
      | "anchorObservedAt"
      | "anchorSourceUrl"
    >
  >;

/**
 * Keys a drink/food price update may target for this venue:
 *   1. venueGroupingKey(prices[0]) when pint rows exist (London canonical)
 *   2. name|address|lat|lng from venue fields (city OSM pubs with empty prices)
 *   3. venue.id (city-prefixed ids like venue-mcr-…) as a last-resort alias
 * Shared by the drink menu seam above and the food layer (lib/venueFoodMenu.ts).
 */
export function venueMenuLookupKeys(venue: VenueMenuVenue): string[] {
  const keys: string[] = [];
  const firstPrice = venue.prices[0];
  if (firstPrice) {
    keys.push(venueGroupingKey(firstPrice));
  }
  // An update is keyed by the name the dataset files, so the operator-suffixed
  // spelling (lib/venueDisplay.ts) is the one the key is built from.
  const keyName = venue.sourceName ?? venue.name;
  if (
    typeof keyName === "string" &&
    keyName.trim() &&
    typeof venue.latitude === "number" &&
    typeof venue.longitude === "number" &&
    Number.isFinite(venue.latitude) &&
    Number.isFinite(venue.longitude)
  ) {
    const coordsKey = venueCoordsGroupingKey(
      keyName,
      venue.address ?? "",
      venue.latitude,
      venue.longitude,
    );
    if (!keys.includes(coordsKey)) keys.push(coordsKey);
  }
  if (venue.id && !keys.includes(venue.id)) keys.push(venue.id);
  return keys;
}
