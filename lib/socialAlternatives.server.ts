import "server-only";

import { readAllDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { buildSocialAlternatives, type SocialAlternatives } from "@/lib/socialAlternatives";
import { getPricedVenues } from "@/lib/venuePriceIndex";

/** Read bundled public menu data. This never reads a session or Social store. */
export async function loadSocialAlternatives(): Promise<SocialAlternatives> {
  const [venues, updates] = await Promise.all([getPricedVenues(), readAllDrinkPriceUpdates()]);
  return buildSocialAlternatives(venues, updates);
}
