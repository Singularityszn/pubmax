import { venueDrinkMenu } from "@/lib/drinkMenu";
import type { Drink } from "@/lib/drinks";
import type { Venue } from "@/lib/venues";

// The seam between the venue sheet (VenueInspector) and the all-drinks menu
// (lib/drinkMenu.ts). Venue.prices (VenuePrice[]) structurally satisfies
// LegacyPintPrice[] — app_price_id, pint_name, price_gbp all line up — so no
// mapping is needed here, just composition.
//
// Sourced-price overlays (lib/drinkPriceUpdates.ts mergeDrinkPriceUpdates +
// public/data/drink_price_updates/latest.json) are deliberately deferred —
// this is the seam where they'll land, once this function also folds the
// overlay in before returning.
export function venueMenuForInspector(venue: Pick<Venue, "id" | "prices">): Drink[] {
  return venueDrinkMenu(venue.id, venue.prices);
}
