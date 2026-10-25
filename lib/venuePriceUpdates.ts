import { alcoholTypeForDrink } from "@/lib/drinks";
import { isNonAlcoholicDrink } from "@/lib/nonAlcoholicDrinks";
import { isValidDrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
// The observed price-update rows about ONE venue, as they ride on venue detail.
//
// The price-update packs and UK price bundle are national. The Drinks tab
// needs only the open pub's rows, so GET /api/venue/[id] scopes them server-side
// and carries them on the venue the sheet already fetches. The bundle reference
// owns the menu-adapter contract: public/data/uk_prices/README.md.
//
// AN UNREAD PACK IS NOT AN EMPTY ONE. The field is `null` when the server could
// not read a required pack or bundle, and `{ drink: [], food: [] }` when the
// reads succeeded and this pub has no row. Both draw the same menu today.
// A surface that wants to say "no sourced price" can tell them apart without
// asking a second time.

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
    const label = row.drinkLabel.trim();
    if (/^[^\p{L}\p{N}]|^\p{Ll}/u.test(label)) return [];
    if (row.category === "alcohol-free") {
      // A large pack in a label does not establish the serving sold at this price.
      if (!row.servingSize && /\b(?:[7-9]\d\s*cl|[7-9]\d{2}\s*ml)\b/i.test(label)) return [];
      if (/^(?:non[- ]alcoholic|alcohol[- ]free)(?:\s+(?:bottles?|beers?|wines?|drinks?))*$/i.test(label) || /\b(?:price range|beer and cider|sparkling wines|mocktails)\b/i.test(label)) return [];
      if (!isNonAlcoholicDrink(label) && (!/\s/.test(label) || /\b(?:sherry|liqueur|tequila|vodka|gin|rum|whisk[ey]+)\b/i.test(label))) return [];
      for (const match of label.matchAll(/(?:^|[^\d.])(\d+(?:[.,]\d+)?)\s*%/g)) {
        if (alcoholTypeForDrink({ name: label, abv: Number(match[1]!.replace(",", ".")) }) !== "low-no") return [];
      }
    }
    const update: DrinkPriceUpdate = { venueKey: row.venueId, drinkName: row.drinkLabel, category: row.category, priceGbp: row.priceGbp, source: { label: row.publisher, url: row.sourceUrl, licence: "Published menu price facts" }, observedAt: row.observedAt, lane: "publisher", ...(row.servingSize ? { servingSize: row.servingSize } : {}) };
    return isValidDrinkPriceUpdate(update, now) ? [update] : [];
  });
}
