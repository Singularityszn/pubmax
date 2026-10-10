// The ONE price precedence for a venue's price area, and the ONE place a
// surface asks whether a pub has a price at all.
//
// The overview tab renders at most one price claim, choosing between nine
// honest sources in a fixed order, and renders the first-drop nudge in the
// branch where none of them exist and the reads permit an absence claim.
// `lib/firstDropNudge.ts` used to restate
// that ordering by hand, so a fourth lane or a reorder in the component would
// silently stop matching the gate (#1413). Both now ask this module, so the
// nudge cannot stand over a recorded price or an unfinished read.

import type { PintPriceSplit } from "@/lib/pintDropAgreement";
import { PRICE_AUTHORITY_MAX_AGE_DAYS } from "@/lib/priceAuthorityWindow";
import { answerEvidenceFor, type AnswerPublisher } from "@/lib/landingHero";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { EstimatedPriceInput, ListedPriceInput, PriceStanding } from "@/lib/priceTier";
import { formatTrustDay, trustPillLabel } from "@/lib/trustPill";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import type { VenuePriceReadStatus } from "@/lib/mapExperienceLens";
import type { VenueDropReadStatus } from "@/lib/venueDropRead";

/**
 * The ONE line a provisional price prints. Captain decision 2026-09-04 (issue
 * #1426): a pub with one drinker's report is not a pub with no price, and this
 * says exactly what it still lacks. Written down once, because a second wording
 * of it would be a second policy.
 */
export const PROVISIONAL_PRICE_LINE = "Logged once, needs a second drinker";

export const PRICE_PENDING_LINE = "Checking prices…";

/**
 * The ONE line an AGED report prints. Captain's cut 5 Sept 2026: a drop past
 * the authority window is still a visible public drop, printed dated in the
 * sheet's own list, so the price area may not say "No price yet" above it. It
 * says what the figure is worth instead, and the day beside it says how old.
 * The window is read from its owner rather than typed.
 */
export const AGED_PRICE_LINE = `Over ${PRICE_AUTHORITY_MAX_AGE_DAYS} days old, needs a fresh drinker`;

/** The price claim the overview area prints, in precedence order. */
export type VenuePriceLaneName =
  | "anchor"
  | "contributor"
  | "sourced"
  | "listed"
  | "provisional"
  | "disputed"
  | "baseline"
  | "aged"
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
 * The figures a pub's in-window drinkers DISAGREE about, as
 * `disputedPintPrices` (lib/venues.ts) found them, with the day the freshest of
 * them was logged. It carries no single figure on purpose: a split has none,
 * and the whole point of the lane is that we stop choosing one.
 */
export type DisputedPriceInput = {
  split: PintPriceSplit;
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
  | {
      lane: "sourced";
      sourcedPrice: NonNullable<PricedVenue["sourcedPrice"]>;
      /** The figure itself. A sourced observation overwrites `cheapestPrice`
       *  in `mergePriceUpdates`, so the attribution row carries no price of its
       *  own and a surface printing one number needs it here. */
      cheapestPrice: number | null;
    }
  | { lane: "listed"; listed: ListedPriceInput }
  | {
      lane: "provisional";
      provisionalPrice: number;
      observedAt: string | number | null;
    }
  | {
      lane: "disputed";
      split: PintPriceSplit;
      observedAt: string | number | null;
    }
  | {
      lane: "baseline";
      cheapestPrice: number;
      /**
       * What this figure is worth, DECIDED once here through the same reading
       * the landing answer card makes, so the peek, the Overview and the
       * landing cannot call one pub's own price three things.
       */
      standing: PriceStanding;
      /** Who published it, for the note that links out. Null when nobody did. */
      publisher: AnswerPublisher | null;
      /** ISO day the publisher's row was last read at its source. Null when no row records a read. */
      observedOn: string | null;
    }
  | {
      lane: "aged";
      agedPrice: number;
      observedAt: string | number | null;
    }
  | { lane: "estimate"; estimate: EstimatedPriceInput };

/** Hold an estimate or an absence until the pub's price reads settle. */
export function venuePriceFallbackPending(
  lane: VenuePriceLane | null,
  priceReadStatus: VenuePriceReadStatus,
  dropReadStatus: VenueDropReadStatus = "ready",
): boolean {
  if (lane && lane.lane !== "estimate") return false;
  return priceReadStatus === "idle" || priceReadStatus === "loading" || dropReadStatus === "idle";
}

/**
 * Which price lane the supplied records support, or null when none qualify.
 *
 * A null lane alone cannot establish an absence while records are unread.
 * Pub surfaces also ask `venuePriceFallbackPending` and the drop-read guard
 * before offering the first-drop nudge.
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
  aged?: ProvisionalPriceInput | null,
  disputed?: DisputedPriceInput | null,
  now: number = Date.now(),
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
  if (sourcedPrice) return { lane: "sourced", sourcedPrice, cheapestPrice };
  // A LISTED BUNDLE ROW OUTRANKS THE BASELINE, because it carries the page it
  // was published at and the day it was read, and the baseline carries a
  // hand-maintained stamp and often no publisher at all.
  if (bundle.listed) return { lane: "listed", listed: bundle.listed };
  // ONE DRINKER'S REPORT SITS BELOW THE LISTED ROW AND ABOVE THE BASELINE. Below,
  // for the same reason the listed row outranks the baseline: it carries a page
  // a reader can open and this carries a drinker. Above, because a report from
  // this month is about tonight and a hand-stamped dataset row is not. It never
  // reaches a band, a bucket or a pin figure; only this area.
  // A SPLIT SITS IN THE PROVISIONAL LANE'S OWN SLOT, and is asked first, because
  // the two are one question about one pub: what this month's drinkers reported.
  // They are disjoint by construction (lib/pintTrust.ts asks the split lane
  // before the provisional one), and asking it first here means a surface can
  // never print one of two disagreeing figures as the pub's single report.
  if (disputed && disputed.split.prices.length > 1) {
    return { lane: "disputed", split: disputed.split, observedAt: disputed.observedAt };
  }
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
  if (cheapestPrice !== null) {
    const { publisher, standing, observedOn } = answerEvidenceFor(
      { priceGbp: cheapestPrice, prices: venue.prices ?? [] },
      now,
    );
    return { lane: "baseline", cheapestPrice, standing, publisher, observedOn };
  }
  // AN AGED REPORT SITS BELOW THE BASELINE AND ABOVE THE MODEL. Below, because
  // a report past the window is no longer about tonight and the baseline at
  // least claims to be a price on record. Above, because a drinker did pay it
  // one night and a modelled figure was paid by nobody. It is a lane rather
  // than nothing for the reason in AGED_PRICE_LINE: the drop is still printed,
  // dated, in the list below, so "No price yet" here would be untrue.
  if (aged && typeof aged.priceGbp === "number" && Number.isFinite(aged.priceGbp)) {
    return { lane: "aged", agedPrice: aged.priceGbp, observedAt: aged.observedAt };
  }
  // AND A MODELLED FIGURE IS LAST, below every price somebody observed. It is
  // still a lane rather than nothing, because a pub we can say something honest
  // about is better than a blank, and `priceStandingFigure` is what stops the
  // "est." coming off it on the way to the screen.
  if (bundle.estimate) return { lane: "estimate", estimate: bundle.estimate };
  return null;
}

/** A venue carrying whatever the UK price bundle holds about it. */
type VenueWithBundlePrices = Venue & { bundlePrices?: VenueBundlePrices | null };

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

/**
 * The figure a lane prints, for a compact surface that shows one number.
 *
 * `estimate` answers null on purpose: nobody observed a modelled figure, and
 * `priceStandingFigure` (lib/priceTier.ts) is the ONE place it may become a
 * string, so a caller that wants it has to go through the module that keeps the
 * "est." on it.
 */
/**
 * THE READER'S WORD FOR THE PRICE WE HOLD, never ours.
 *
 * Captain 6 Sep 2026, reading the venue sheet head: under the price it said
 * "baseline on record". That is an internal word. It means the LISTED price we
 * hold for this pub, and the rest of the product already has a word for that,
 * on the landing answer card and now on the cheap pint board: "Listed", with
 * the day it was collected.
 *
 * The word is `trustPillLabel`, the ONE place a standing becomes a word, over
 * the standing the lane already decided. A baseline row nobody published cannot
 * claim a listing and says what it really is instead, which is the same fork
 * the Overview's own note has always drawn.
 *
 * The day is the day THIS ROW was last read at its source, in the format the
 * landing card prints it, because a price we hold is only as good as the day we
 * read it. It is never the dataset's collection day: a re-collection re-reads
 * only the rows its source still states, and a row it did not read keeps the
 * day it was read. A row that has aged past the listed window stops claiming a
 * listing on its own, without anything being rewritten.
 */
export const BASELINE_NO_PUBLISHER_CAPTION = "Price on record, publisher not recorded";

export function baselineTrustCaption(lane: {
  standing: PriceStanding;
  publisher: AnswerPublisher | null;
  observedOn: string | null;
}): string {
  if (lane.standing !== "listed" || !lane.publisher || !lane.observedOn) {
    return BASELINE_NO_PUBLISHER_CAPTION;
  }
  return `${trustPillLabel("listed")} · collected ${formatTrustDay(Date.parse(`${lane.observedOn}T12:00:00.000Z`))}`;
}

export function venuePriceLaneObservedGbp(lane: VenuePriceLane): number | null {
  switch (lane.lane) {
    case "anchor":
      return lane.cheapestPrice;
    case "contributor":
      return lane.contributorPrice;
    case "sourced":
      return lane.cheapestPrice;
    case "listed":
      return lane.listed.priceGbp;
    case "provisional":
      return lane.provisionalPrice;
    // NO FIGURE. Two prices have no one number, and handing a compact surface
    // either of them would publish a price half the reporters did not pay.
    case "disputed":
      return null;
    case "baseline":
      return lane.cheapestPrice;
    case "aged":
      return lane.agedPrice;
    case "estimate":
      return null;
  }
}

/**
 * Whether this lane's figure is a DRINKER'S OWN LOG.
 *
 * The prices-by-drink block words its absence as "no beer price logged here
 * yet", and a Pint Drop IS a log, so that line may not stand over one (#1426 follow-up).
 * A sourced, listed, baseline or modelled figure was not logged by a drinker,
 * so the line stays true beside those, and an anchor is not a pint at all.
 */
export function venuePriceLaneIsDrinkerLog(lane: VenuePriceLane): boolean {
  return (
    lane.lane === "contributor" ||
    lane.lane === "provisional" ||
    lane.lane === "disputed" ||
    lane.lane === "aged"
  );
}
