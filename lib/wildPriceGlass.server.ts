import "server-only";

// The read behind the Price Glass (lib/wildPriceGlass.ts), wired once.
//
// The landing document is prerendered (app/page.tsx, force-static), so this
// runs at build and on each hourly regeneration, never per visitor. The venue
// read is the memoised London priced index the landing already holds, and the
// two hunt pints arrive from app/page.tsx, which owns the hunt read. Nothing
// is held here: the pours are a pass over a list already in memory, and they
// follow whichever pints the page hands over. A failed read pours nothing
// rather than an invented figure.

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
