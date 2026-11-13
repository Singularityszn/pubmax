// Client-safe map deep-link helper. Kept out of lib/venueIndex.ts so browser
// components never pull in Node `fs` (Turbopack rejects that at build time).

import type { Route } from "next";

import { cityAwareMapPath } from "@/lib/cityMapHref";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";

/** Canonical "open this pub on the map" link — `?sel=` selects the venue on load. */
export function venueMapUrl(id: string): Route {
  return cityAwareMapPath(
    cityIdFromVenueId(id),
    `sel=${encodeURIComponent(id)}`,
  );
}

/**
 * "Ask this pub for a table" deep link: the browse link plus the crew size the
 * reader named. The selected pub's action card reads and validates `table`
 * against the form's own doors (lib/tableRequestIntent.ts), so an out-of-range
 * value opens nothing; this builder stays a light leaf every surface can import.
 */
export function venueTableRequestUrl(id: string, partySize: number): Route {
  return `${venueMapUrl(id)}&table=${partySize}` as Route;
}

/**
 * The four surfaces that can hand a pub off as an EXPLICIT acceptance (a pin tap
 * or a plain `?sel=` link is browse-only and never appears here — see §4.8).
 */
export type VenueAcceptanceSource = "near" | "map-search" | "tonight" | "pal";

/**
 * Explicit-acceptance deep link (§4.6): `?sel=<id>&accept=1&src=<source>`. Unlike
 * {@link venueMapUrl}, `accept=1` marks a person who committed to this Venue (not
 * just inspected it) and `src` fixes the acceptance origin so the Map never has
 * to guess it from the current UI. City-aware exactly like the browse link.
 */
export function venueAcceptUrl(id: string, source: VenueAcceptanceSource): Route {
  return cityAwareMapPath(
    cityIdFromVenueId(id),
    `sel=${encodeURIComponent(id)}&accept=1&src=${encodeURIComponent(source)}`,
  );
}
