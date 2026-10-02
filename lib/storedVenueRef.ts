// What a stored venue reference names, read through the alias maps.
//
// A pint drop, a save or a crawl stop keeps the venue id it was written with.
// That id may since have been merged into another venue, superseded by a city
// pack refresh, or retired because the pub left OpenStreetMap. Pure, so a
// reader that already holds the venue index and the alias maps resolves many
// stored ids in one pass.

import type { RetiredVenue, VenueAliasResolver } from "@/lib/venueAliases";
import type { VenueRef } from "@/lib/venueIndex";

/** The note a retired pub's name carries wherever a stored reference prints it. */
const RETIRED_VENUE_NOTE = "may have closed";

/**
 * A retired pub as a reader answers for it: its own name with the note, its
 * own area and its last point, flagged so no listing surface draws it.
 */
export function retiredVenueRef(retired: RetiredVenue): VenueRef {
  return {
    id: retired.id,
    name: `${retired.name} (${RETIRED_VENUE_NOTE})`,
    borough: retired.area,
    lat: retired.lat,
    lng: retired.lng,
    retired: true,
  };
}

/**
 * The venue a stored reference names: the venue its id resolves to now, or the
 * retired pub it names. Undefined only for an id no venue and no record holds.
 */
export function storedVenueRef(
  index: ReadonlyMap<string, VenueRef>,
  aliases: VenueAliasResolver,
  storedId: string,
): VenueRef | undefined {
  const venueId = aliases.canonical(storedId);
  const retired = aliases.retired(venueId);
  return index.get(venueId) ?? (retired ? retiredVenueRef(retired) : undefined);
}
