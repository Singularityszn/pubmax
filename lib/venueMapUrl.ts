// Client-safe map deep-link helper. Kept out of lib/venueIndex.ts so browser
// components never pull in Node `fs` (Turbopack rejects that at build time).

import { cityIdFromVenueId } from "@/lib/cityVenueIds";

/** Canonical "open this pub on the map" link — `?sel=` selects the venue on load. */
export function venueMapUrl(id: string): string {
  const cityId = cityIdFromVenueId(id);
  const base = cityId && cityId !== "london" ? `/map/${cityId}` : "/map";
  return `${base}?sel=${encodeURIComponent(id)}`;
}
