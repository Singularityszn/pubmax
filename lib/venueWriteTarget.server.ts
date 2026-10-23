import "server-only";

// The ONE resolver every community write runs its venue id through before a
// row is stored.
//
// A write keyed on an id nobody resolved is a row no surface can ever read
// back: an alias splits one pub's contributions across two keys, and an id the
// index does not hold seeds a venue that does not exist. So a caller's id is
// canonicalised first, and an unknown one is refused with the house error.
//
// The UK base layer is admitted by its own id index, because those pubs are
// streamed per viewport and are absent from the curated venue index. A base id
// a refresh dropped is answered by the id it aliases to, which may be the
// curated venue that owned the row.
//
// `pubsOnly` is the narrower question a PRICE lane asks: a figure printed as a
// pint price may only come from a pub kind. A crowd occupancy reading is about
// seats, and the venue sheet offers it on every kind, so that lane does not
// narrow.
//
// `resolvePriceVenueId` is the price lane's door, and it admits ONE thing
// beyond a pub: a London fast-food counter (`venue-osm-…`, kind `food`), for a
// Coke Zero or Diet Coke price and nothing else (lib/londonFoodPlaces.ts owns
// that rule). The counter must be in the London food pack, so an id is never
// accepted on its shape.

import type { DrinkCategory } from "@/lib/drinks";
import { lookupLondonFoodPlace } from "@/lib/londonFoodIndex.server";
import { foodPlacePriceRefusal } from "@/lib/londonFoodPlaces";
import { isLondonVenueId } from "@/lib/londonVenueShards";
import { currentUkBaseId, getUkBaseIdIndex } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export type VenueWriteTarget =
  | { ok: true; venueId: string }
  | { ok: false; status: 400 | 503; error: string };

const UNKNOWN_VENUE = "Pick a venue from the map.";
const VENUES_UNAVAILABLE =
  "Venue list is unavailable right now, try again shortly.";

export async function resolveWritableVenueId(
  venueId: string,
  opts?: { pubsOnly?: boolean },
): Promise<VenueWriteTarget> {
  const currentId = isUkBaseId(venueId) ? await currentUkBaseId(venueId) : venueId;
  if (!currentId) {
    return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
  }
  if (isUkBaseId(currentId)) {
    const ukBaseIndex = await getUkBaseIdIndex();
    if (ukBaseIndex.status === "unavailable") {
      return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
    }
    return ukBaseIndex.ids.has(currentId)
      ? { ok: true, venueId: currentId }
      : { ok: false, status: 400, error: UNKNOWN_VENUE };
  }

  const venueLookup = await lookupCanonicalVenue(currentId);
  if (venueLookup.status === "unavailable") {
    return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
  }
  if (venueLookup.status !== "found") {
    return { ok: false, status: 400, error: UNKNOWN_VENUE };
  }
  if (opts?.pubsOnly && !isPubVenueKind(venueLookup.venue.kind)) {
    return { ok: false, status: 400, error: UNKNOWN_VENUE };
  }
  return { ok: true, venueId: venueLookup.canonicalId };
}

/**
 * The venue a community PRICE may be written against. A pub, as
 * `resolveWritableVenueId` with `pubsOnly` answers it, or a London fast-food
 * counter the food pack holds, for the one lane a counter takes.
 */
export async function resolvePriceVenueId(
  venueId: string,
  lane: { drinkCategory: DrinkCategory; drinkSubtype: unknown },
): Promise<VenueWriteTarget> {
  if (!isLondonVenueId(venueId)) {
    return resolveWritableVenueId(venueId, { pubsOnly: true });
  }
  const lookup = await lookupLondonFoodPlace(venueId);
  if (lookup.status === "unavailable") {
    return { ok: false, status: 503, error: VENUES_UNAVAILABLE };
  }
  if (lookup.status === "missing") {
    return { ok: false, status: 400, error: UNKNOWN_VENUE };
  }
  const refusal = foodPlacePriceRefusal(lane);
  if (refusal) return { ok: false, status: 400, error: refusal };
  return { ok: true, venueId: lookup.place.id };
}
