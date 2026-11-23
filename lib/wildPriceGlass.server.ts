import "server-only";

// A failed venue read returns no glass rather than an invented figure.

import { getPricedVenues } from "@/lib/venuePriceIndex";
import { buildWildPriceGlass, type PriceGlassPint, type WildPriceGlass } from "@/lib/wildPriceGlass";

export async function loadWildPriceGlass(pints: {
  cheapest: PriceGlassPint | null;
  dearest: PriceGlassPint | null;
}): Promise<WildPriceGlass | null> {
  try {
    return buildWildPriceGlass({ venues: await getPricedVenues(), ...pints });
  } catch {
    return null;
  }
}
