import {
  applyFoodPriceUpdatesToMenu,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";
import type { FoodItem } from "@/lib/food";
import { venueMenuLookupKeys, type VenueMenuVenue } from "@/lib/venueMenu";

// Like lib/venueMenu.ts, the observed food-price updates
// (public/data/food_price_updates/latest.json, ~1.5 MB) are loaded at runtime
// via lib/priceUpdatesLoader.ts and passed in, never statically imported —
// a static import bundled the whole file into the map's client JS.

function applyFoodUpdatesForKeys(
  base: FoodItem[],
  keys: string[],
  updates: FoodPriceUpdate[],
): FoodItem[] {
  if (keys.length === 0) return base;
  const keySet = new Set(keys);
  const scoped = updates.filter((u) => keySet.has(u.venueKey));
  if (scoped.length === 0) return base;
  const canonical = keys[0];
  const remapped = scoped.map((u) => (u.venueKey === canonical ? u : { ...u, venueKey: canonical }));
  return applyFoodPriceUpdatesToMenu(canonical, base, remapped);
}

/** Food menu for the venue inspector — sourced updates only (no seed layer yet). */
export function venueFoodMenuForInspector(
  venue: VenueMenuVenue,
  updates: FoodPriceUpdate[] = [],
): FoodItem[] {
  return applyFoodUpdatesForKeys([], venueMenuLookupKeys(venue), updates);
}
