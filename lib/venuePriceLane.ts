// The ONE price precedence for a venue's price area, and the ONE place a
// surface asks whether a pub has a price at all.
//
// The overview tab renders at most one price claim, choosing between seven
// honest sources in a fixed order, and renders the first-drop nudge in the
// branch where none of them exist. `lib/firstDropNudge.ts` used to restate
// that ordering by hand, so a fourth lane or a reorder in the component would
// silently stop matching the gate (#1413). Both now ask this module, so the
// nudge shows in — and only in — the branch that would otherwise render
// nothing.

import type { PricedVenue } from "@/lib/priceUpdates";
import type { EstimatedPriceInput, ListedPriceInput } from "@/lib/priceTier";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

/**
 * The ONE line a provisional price prints. Captain decision 2026-09-04 (issue
 * #1426): a pub with one drinker's report is not a pub with no price, and this
 * says exactly what it still lacks. Written down once, because a second wording
 * of it would be a second policy.
 */
export const PROVISIONAL_PRICE_LINE = "Logged once, needs a second drinker";

/** The price claim the overview area prints, in precedence order. */
export type VenuePriceLaneName =
  | "anchor"
  | "contributor"
  | "sourced"
  | "listed"
  | "provisional"
  | "baseline"
  | "estimate";

/**
 * A pint report that is in window but has NOT earned the map, as
 * `provisionalPriceDrop` (lib/venues.ts) found it. `observedAt` takes an epoch
 * or an ISO string because the drop signal carries epoch milliseconds and the
 * venue record carries ISO; `formatFreshness` reads both.
 */
export type ProvisionalPriceInput = {
  priceGbp: number;
  observedAt: string | number | null;
};

/**
 * What the UK price bundle holds about this pub, already narrowed to the two
 * shapes lib/priceTier.ts takes.
 *
 * The bundle carries the rows; the DECISION about what they are worth stays
 * with `priceStandingFor`, so this is an input to the precedence rather than a
 * second opinion inside it. Absent means the bundle was not asked or could not
 * be read, which is why both fields are nullable and neither defaults.
 */
export type VenueBundlePrices = {
  listed?: ListedPriceInput | null;
  estimate?: EstimatedPriceInput | null;
};

/**
 * The winning lane and the value it prints. Each variant carries what its
 * branch needs, so the render component reads a narrowed figure off the
 * decision rather than re-testing the fields the decision was made on.
 */
export type VenuePriceLane =
  | { lane: "anchor"; anchorLabel: string; cheapestPrice: number }
  | { lane: "contributor"; contributorPrice: number }
  | { lane: "sourced"; sourcedPrice: NonNullable<PricedVenue["sourcedPrice"]> }
  | { lane: "listed"; listed: ListedPriceInput }
  | {
      lane: "provisional";
      provisionalPrice: number;
      observedAt: string | number | null;
    }
  | { lane: "baseline"; cheapestPrice: number }
  | { lane: "estimate"; estimate: EstimatedPriceInput };

/**
 * Which price lane a venue's price area renders, or null when it has no price
 * on record at all and the first-drop nudge takes the space instead.
 *
 * A `null` answer is the ONE definition of "no price yet" this tree has. Every
 * surface that words that absence asks here, so none of them can go on saying
 * it over a pub whose lane has since started answering.
 *
 * `sourcedPrice` is passed in rather than read off the venue because the
 * render component already holds it as a prop; both callers derive it the same
 * way, through `venueSourcedPrice`.
 */
export function venuePriceLane(
  venue: Venue,
  latestContributorPrice: number | null | undefined,
  sourcedPrice: PricedVenue["sourcedPrice"],
  bundle: VenueBundlePrices = {},
  provisional?: ProvisionalPriceInput | null,
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
  // A LISTED BUNDLE ROW OUTRANKS THE BASELINE, because it carries the page it
  // was published at and the day it was read, and the baseline carries a
  // hand-maintained stamp and often no publisher at all.
  if (bundle.listed) return { lane: "listed", listed: bundle.listed };
  // ONE DRINKER'S REPORT SITS BELOW THE LISTED ROW AND ABOVE THE BASELINE. Below,
  // for the same reason the listed row outranks the baseline: it carries a page
  // a reader can open and this carries a drinker. Above, because a report from
  // this month is about tonight and a hand-stamped dataset row is not. It never
  // reaches a band, a bucket or a pin figure; only this area.
  if (
    provisional &&
    typeof provisional.priceGbp === "number" &&
    Number.isFinite(provisional.priceGbp)
  ) {
    return {
      lane: "provisional",
      provisionalPrice: provisional.priceGbp,
      observedAt: provisional.observedAt,
    };
  }
  if (cheapestPrice !== null) return { lane: "baseline", cheapestPrice };
  // AND A MODELLED FIGURE IS LAST, below every price somebody observed. It is
  // still a lane rather than nothing, because a pub we can say something honest
  // about is better than a blank, and `priceStandingFigure` is what stops the
  // "est." coming off it on the way to the screen.
  if (bundle.estimate) return { lane: "estimate", estimate: bundle.estimate };
  return null;
}

/** A venue carrying whatever the UK price bundle holds about it. */
export type VenueWithBundlePrices = Venue & { bundlePrices?: VenueBundlePrices | null };

/**
 * The bundle-price lane input every caller derives the same way, exactly as
 * `venueSourcedPrice` is derived. Absent reads as an empty answer rather than
 * as "no price": the bundle may simply not have been asked on this surface.
 */
export function venueBundlePrices(venue: Venue): VenueBundlePrices {
  return (venue as VenueWithBundlePrices).bundlePrices ?? {};
}

/** The sourced-price lane input both callers derive the same way. */
export function venueSourcedPrice(venue: Venue): PricedVenue["sourcedPrice"] {
  return (venue as PricedVenue).sourcedPrice ?? null;
}
