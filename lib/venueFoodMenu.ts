import {
  applyFoodPriceUpdatesToMenu,
  parseFoodPriceUpdates,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";
import type { FoodItem } from "@/lib/food";
import { venueMenuLookupKeys, type VenueMenuVenue } from "@/lib/venueMenu";
import rawFoodPriceUpdates from "../public/data/food_price_updates/latest.json";

const updateFileGeneratedAt = Date.parse(
  String((rawFoodPriceUpdates as { generatedAt?: unknown }).generatedAt ?? ""),
);
const foodPriceUpdates = parseFoodPriceUpdates(
  rawFoodPriceUpdates,
  Number.isFinite(updateFileGeneratedAt) ? updateFileGeneratedAt : Date.now(),
);

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
export function venueFoodMenuForInspector(venue: VenueMenuVenue): FoodItem[] {
  return applyFoodUpdatesForKeys([], venueMenuLookupKeys(venue), foodPriceUpdates);
}
