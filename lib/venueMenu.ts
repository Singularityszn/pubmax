import { venueDrinkMenu } from "@/lib/drinkMenu";
import {
  applyDrinkPriceUpdatesToMenu,
  parseDrinkPriceUpdates,
} from "@/lib/drinkPriceUpdates";
import type { Drink } from "@/lib/drinks";
import { venueGroupingKey, type Venue } from "@/lib/venues";
import rawDrinkPriceUpdates from "../public/data/drink_price_updates/latest.json";

// The seam between the venue sheet (VenueInspector) and the all-drinks menu
// (lib/drinkMenu.ts). Venue.prices (VenuePrice[]) structurally satisfies
// LegacyPintPrice[] — app_price_id, pint_name, price_gbp all line up — so no
// mapping is needed here, just composition.
//
const updateFileGeneratedAt = Date.parse(
  String((rawDrinkPriceUpdates as { generatedAt?: unknown }).generatedAt ?? ""),
);
const drinkPriceUpdates = parseDrinkPriceUpdates(
  rawDrinkPriceUpdates,
  Number.isFinite(updateFileGeneratedAt) ? updateFileGeneratedAt : Date.now(),
);

export function venueMenuForInspector(venue: Pick<Venue, "id" | "prices">): Drink[] {
  const base = venueDrinkMenu(venue.id, venue.prices);
  const firstPrice = venue.prices[0];
  if (!firstPrice) return base;
  return applyDrinkPriceUpdatesToMenu(venueGroupingKey(firstPrice), base, drinkPriceUpdates);
}
