// Client-safe map deep-link helper. Kept out of lib/venueIndex.ts so browser
// components never pull in Node `fs` (Turbopack rejects that at build time).

import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";

/** Canonical "open this pub on the map" link — `?sel=` selects the venue on load. */
export function venueMapUrl(id: string): string {
  return cityAwareMapPath(
    cityIdFromVenueId(id),
    `sel=${encodeURIComponent(id)}`,
  );
}
