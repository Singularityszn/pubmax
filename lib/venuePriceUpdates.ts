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

import { authoritativeBundleRows, strongestBundleRow, type UkPriceBundleRow } from "@/lib/ukPriceBundle";

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

/** Named non-beer menu observations can ride the existing venue-menu read. */
export function namedNonBeerBundleUpdates(rows: readonly UkPriceBundleRow[], now = Date.now()): DrinkPriceUpdate[] {
  return authoritativeBundleRows(rows).flatMap((row) => {
    if ((row.category !== "coffee" && row.category !== "alcohol-free") || !row.drinkLabel || !row.sourceUrl || !row.publisher || strongestBundleRow([row], now).standing !== "listed") return [];
    // The legacy reader can mistake a coffee liqueur or its neighbour for coffee.
    // Only plain named coffee servings cross this display adapter.
    if (row.category === "coffee" && !/^(?:(?:single|double|iced|filter|decaf|oat)\s+){0,2}(?:espresso|americano|cappuccino|latte|flat white|mocha|matcha(?: latte)?|macchiato|cortado|coffee)$/i.test(row.drinkLabel.trim())) return [];
    if (row.category === "alcohol-free" && /\b[1-9]\d*(?:\.\d+)?\s*%/.test(row.drinkLabel)) return [];
    return [{ venueKey: row.venueId, drinkName: row.drinkLabel, category: row.category, priceGbp: row.priceGbp, source: { label: row.publisher, url: row.sourceUrl, licence: "Published menu price facts" }, observedAt: row.observedAt, lane: "publisher" as const, ...(row.servingSize ? { servingSize: row.servingSize } : {}) }];
  });
}
