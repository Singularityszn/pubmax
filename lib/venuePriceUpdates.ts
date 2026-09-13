// The observed price-update rows about ONE venue, as they ride on venue detail.
//
// The two packs (public/data/{drink,food}_price_updates/latest.json, 1862 KB
// and 1519 KB) are national. The Drinks tab draws a handful of rows about the
// pub whose sheet is open, so GET /api/venue/[id] scopes them server-side and
// carries them on the venue the sheet already fetches, the same seam
// `bundlePrices` uses (lib/venuePriceLane.ts).
//
// AN UNREAD PACK IS NOT AN EMPTY ONE. The field is `null` when the server could
// not read a pack, and `{ drink: [], food: [] }` when it read them and this pub
// has no row. Both draw the same menu today, but a surface that wants to say
// "no sourced price" can tell them apart without asking a second time.

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { FoodPriceUpdate } from "@/lib/foodPriceUpdates";
import type { Venue } from "@/lib/venues";

export type VenuePriceUpdates = {
  drink: DrinkPriceUpdate[];
  food: FoodPriceUpdate[];
};

export type VenueWithPriceUpdates = Venue & {
  priceUpdates?: VenuePriceUpdates | null;
};

const NONE: VenuePriceUpdates = { drink: [], food: [] };

/** This venue's own overlay rows, or an empty pair when the detail carries none. */
export function venuePriceUpdatesOf(venue: Venue): VenuePriceUpdates {
  const updates = (venue as VenueWithPriceUpdates).priceUpdates;
  if (!updates) return NONE;
  return {
    drink: Array.isArray(updates.drink) ? updates.drink : [],
    food: Array.isArray(updates.food) ? updates.food : [],
  };
}
