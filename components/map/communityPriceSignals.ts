import { drivesMap, mapCandidateOf, type CommunityPrice } from "@/lib/communityPrice";
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
//
// AND IT IS THE TRUST GATE. Because this is the only door onto the map, it is
// also where an anonymous figure has to earn the map: `drivesMap` (see
// lib/communityPrice.ts) requires a second independent submitter agreeing about
// the same drink, and drops the price back to the scraped baseline once it is
// over 30 days old. Captain decision 2026-07-26, closing review findings F1
// (product half) and F4.
//
// A gated price is not deleted, it is simply not merged - the venue sheet reads
// `communityPrices.byVenueId` directly and still shows every submission, dated,
// with `communityTrustNote` saying where it stands. That split is the whole
// design: the pub's own page is a record of what people reported; the map is a
// claim about tonight's prices, and only a corroborated, recent figure gets to
// make it.

/** The venue-signal fields this merge reads; usePintDrops supplies them all. */
export type PricedVenueSignal = VenueSignal;

/**
 * Merge community-submitted prices into the venue-signal map used for pin
 * colour, list rows and the sheet. Pure: returns a NEW map, never mutates the
 * input. Returns the input untouched when there is nothing to merge - or when
 * nothing on offer has earned the map - so the common case allocates nothing.
 *
 * `now` is a parameter rather than a `Date.now()` read inside the loop so the
 * age gate is testable and one render can never date two venues differently.
 */
export function mergeCommunityPriceSignals<S extends PricedVenueSignal>(
  signals: Map<string, S>,
  communityPrices: Map<string, CommunityPrice>,
  now: number = Date.now(),
): Map<string, S> {
  if (communityPrices.size === 0) return signals;
  let merged: Map<string, S> | null = null;
  for (const [venueId, price] of communityPrices) {
    // What the map paints is the category's best-corroborated in-window figure
    // (mapCandidateOf), not the freshest report - so a lone fresh disagreement
    // can neither repaint the map nor un-paint a corroborated price. The sheet
    // keeps showing the freshest row for itself, standing note and all.
    const candidate = mapCandidateOf(price);
    // The trust gate, before anything else: uncorroborated or stale prices
    // never reach a pin, a list row or a cheapest bucket.
    if (!drivesMap(candidate, now)) continue;
    const existing = (merged ?? signals).get(venueId);
    const dropAt = existing?.latestContributorAt;
    // Only step aside for a Pint Drop we KNOW is newer. An unknown drop age
    // yields to the submission, which is the observation we can date.
    if (typeof dropAt === "number" && dropAt > candidate.submittedAt) continue;
    merged ??= new Map(signals);
    merged.set(venueId, {
      ...(existing ?? ({ hasPintDrops: false, latestContributorPrice: null } as S)),
      latestContributorPrice: candidate.priceGbp,
      latestContributorAt: candidate.submittedAt,
    });
  }
  return merged ?? signals;
}
