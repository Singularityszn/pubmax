import "server-only";

import { getNightAreasForCity } from "@/lib/nightAreas";
import type { CompactNightArea } from "@/lib/nightAreaGeometry";

/** Only the public geometry needed to choose a coarse London area. */
export function tonightNightAreas(): CompactNightArea[] {
  return getNightAreasForCity("london").map(({ slug, centre }) => ({ slug, centre }));
}
