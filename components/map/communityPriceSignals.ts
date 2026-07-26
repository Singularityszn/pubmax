import type { CommunityPrice } from "@/lib/communityPrice";
import type { VenueSignal } from "./canvas/types";

// The one seam that turns a submitted price into a restamped map.
//
// PubMap already derives `venueSignals` from the Pint Drops layer and hands the
// SAME map to the pins (PubMapCanvas), the venue list, the route panel and the
// venue sheet. Folding community submissions in here means every one of those
// surfaces restamps from a single merge - the map canvas itself needs no change.
//
// Freshest-wins, never backwards: a community submission takes the price only
// when it is the newer observation, so a three-day-old logged price can't
// displace a Pint Drop from tonight. `hasPintDrops` is left exactly as it was -
// a logged price is not a Pint Drop, and it must not light the "has drops" halo
// or pass the has-drops filter.

/** The venue-signal fields this merge reads; usePintDrops supplies them all. */
export type PricedVenueSignal = VenueSignal;

/**
 * Merge community-submitted prices into the venue-signal map used for pin
 * colour, list rows and the sheet. Pure: returns a NEW map, never mutates the
 * input. Returns the input untouched when there is nothing to merge, so the
 * common case allocates nothing.
 */
export function mergeCommunityPriceSignals<S extends PricedVenueSignal>(
  signals: Map<string, S>,
  communityPrices: Map<string, CommunityPrice>,
): Map<string, S> {
  if (communityPrices.size === 0) return signals;
  const merged = new Map(signals);
  for (const [venueId, price] of communityPrices) {
    const existing = merged.get(venueId);
    const dropAt = existing?.latestContributorAt;
    // Only step aside for a Pint Drop we KNOW is newer. An unknown drop age
    // yields to the submission, which is the observation we can date.
    if (typeof dropAt === "number" && dropAt > price.submittedAt) continue;
    merged.set(venueId, {
      ...(existing ?? ({ hasPintDrops: false, latestContributorPrice: null } as S)),
      latestContributorPrice: price.priceGbp,
      latestContributorAt: price.submittedAt,
    });
  }
  return merged;
}
