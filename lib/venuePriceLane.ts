// The ONE price precedence for a venue's overview price area.
//
// The overview tab renders at most one price claim, choosing between four
// honest sources in a fixed order, and renders the first-drop nudge in the
// branch where none of them exist. `lib/firstDropNudge.ts` used to restate
// that ordering by hand, so a fourth lane or a reorder in the component would
// silently stop matching the gate (#1413). Both now ask this module, so the
// nudge shows in — and only in — the branch that would otherwise render
// nothing.

import type { PricedVenue } from "@/lib/priceUpdates";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

/** The price claim the overview area prints, in precedence order. */
export type VenuePriceLaneName = "anchor" | "contributor" | "sourced" | "baseline";

/**
 * The winning lane and the value it prints. Each variant carries what its
 * branch needs, so the render component reads a narrowed figure off the
 * decision rather than re-testing the fields the decision was made on.
 */
export type VenuePriceLane =
  | { lane: "anchor"; anchorLabel: string; cheapestPrice: number }
  | { lane: "contributor"; contributorPrice: number }
  | { lane: "sourced"; sourcedPrice: NonNullable<PricedVenue["sourcedPrice"]> }
  | { lane: "baseline"; cheapestPrice: number };

/**
 * Which price lane a venue's overview area renders, or null when it has no
 * price on record and the first-drop nudge takes the space instead.
 *
 * `sourcedPrice` is passed in rather than read off the venue because the
 * render component already holds it as a prop; both callers derive it the same
 * way, through `venueSourcedPrice`.
 */
export function venuePriceLane(
  venue: Venue,
  latestContributorPrice: number | null | undefined,
  sourcedPrice: PricedVenue["sourcedPrice"],
): VenuePriceLane | null {
  const cheapestPrice =
    venue.cheapestPrice !== null && venue.cheapestPrice !== undefined
      ? venue.cheapestPrice
      : null;
  if (!isPubVenue(venue) && venue.anchorLabel && cheapestPrice !== null) {
    return { lane: "anchor", anchorLabel: venue.anchorLabel, cheapestPrice };
  }
  if (latestContributorPrice !== null && latestContributorPrice !== undefined) {
    return { lane: "contributor", contributorPrice: latestContributorPrice };
  }
  if (sourcedPrice) return { lane: "sourced", sourcedPrice };
  if (cheapestPrice !== null) return { lane: "baseline", cheapestPrice };
  return null;
}

/** The sourced-price lane input both callers derive the same way. */
export function venueSourcedPrice(venue: Venue): PricedVenue["sourcedPrice"] {
  return (venue as PricedVenue).sourcedPrice ?? null;
}
