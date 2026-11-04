// THE ONE trust-state derivation for a pub's Pint Drop lane.
//
// Captain's cut for v0 (5 Sept 2026, Fable51Fix section 1): the trust story
// must read one way everywhere. Before this module the pins, the Overview
// chip, the phone peek and the near-you rows each asked two or three of the
// drop lanes in lib/venues.ts for themselves and stitched an answer, so one
// surface could word an absence over a drop another surface was printing. Now
// every surface asks THIS module for the state and reads its own words and
// tone off the closed tables below.
//
// SEVEN STATES, weakest last, and each is a READING at `now`, never a write.
//
//   confirmed     the server minted a confirmation and it is inside the window
//                 lib/priceTier.ts owns (CONFIRMED_MAX_AGE_DAYS). Paints the
//                 pin's band and figure, wears the confirmed badge (a hollow
//                 ring, never a colour), prints the trust pill, may lead the
//                 cheapest-pint story.
//   corroborated  no minted confirmation, but this browser can still prove two
//                 independent in-window reports from the keys it was handed
//                 (corroboratedPriceDrop). Same authority as `confirmed` on the
//                 map, because it IS the same agreement; it only lacks the
//                 record the server writes. No badge, no pill.
//   disputed      two or more in-window public reports about the same drink and
//                 measure, holding DIFFERENT figures (disputedPintPrices).
//                 Captain 7 Sept 2026, over Grok's reading of the 08:37 deploy:
//                 Hatton held £4.50 and £4.70 and every surface said "Logged
//                 once, needs a second drinker". The second drinker had already
//                 arrived and disagreed, so the product says that instead:
//                 "Two drinkers, two prices: £4.50 and £4.70". Paints the same
//                 provisional MARK as one report, and no figure, because two
//                 figures have no one band.
//   logged-once   one in-window public report with a bill, or written before
//                 the bill became optional (provisionalPriceDrop). Paints the
//                 pin's provisional MARK and nothing else; the sheet prints the
//                 figure, dated, with PROVISIONAL_PRICE_LINE.
//   unchecked     the only in-window public report is a typed price with NO
//                 bill (uncheckedPriceDrop; captain decision 9, 1 Nov 2026).
//                 Paints NOTHING on the pin, not even the mark; the sheet
//                 prints the figure, dated, on the neutral plaque, as "Logged
//                 by @handle, not checked" with UNCHECKED_PRICE_LINE. A second
//                 independent drinker agreeing with it reads `corroborated`
//                 (or `confirmed` once minted), exactly as for any report.
//   aged-out      every public priced report here is past the window
//                 (agedPriceDrop), an expired confirmation included. Paints
//                 NOTHING on the pin; the sheet still prints the figure, dated,
//                 with AGED_PRICE_LINE, because the drop list below it prints
//                 that same drop and "No price yet" above it would be untrue.
//   none          no public priced report at all.
//
// A confirmation older than the window therefore drops back at read time: the
// pair's drops are older than the confirmation, so the pub reads `aged-out`,
// and nothing is deleted or rewritten to get there.
//
// This module DECIDES NOTHING OF ITS OWN. Each state is one of the six drop
// lanes in lib/venues.ts asked in order, the window is lib/priceTier.ts's, the
// agreement bar is lib/pintDropAgreement.ts's and the words are
// lib/venuePriceLane.ts's. It exists so the order and the
// projection into a `VenueSignal` are written once.
//
// The Pint Index producer (lib/pintIndexFromConfirmations.ts) reads the SAME
// `confirmationIsLive` this module reads `confirmed` through, so a pub the
// Index cites and a pub this module calls confirmed are one set by
// construction; __tests__/pintTrust.test.ts holds the two to each other.

import type { ConfirmedPriceInput, PriceStanding } from "@/lib/priceTier";
import {
  AGED_PRICE_LINE,
  PROVISIONAL_PRICE_LINE,
  UNCHECKED_PRICE_LINE,
  venuePriceLaneObservedGbp,
  venuePriceLaneUncheckedBy,
  type DisputedPriceInput,
  type ProvisionalPriceInput,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import { confirmPintActionLabel } from "@/lib/pintDropSecondDrinker";
import { type PintPriceSplit } from "@/lib/pintDropAgreement";
import { isUncheckedPrice } from "@/lib/pintDropReceipt";
import {
  agedPriceDrop,
  confirmedPriceDrop,
  corroboratedPriceDrop,
  disputedPintPrices,
  provisionalPriceDrop,
  uncheckedPriceDrop,
  type SummaryDrop,
} from "@/lib/venues";
import type { PintDropConfirmation } from "@/lib/pintDropConfirmationRecord";

/** The closed set, weakest last. A surface narrows FROM this list. */
export const PINT_TRUST_STATES = [
  "confirmed",
  "corroborated",
  "disputed",
  "logged-once",
  "unchecked",
  "aged-out",
  "none",
] as const;
export type PintTrustState = (typeof PINT_TRUST_STATES)[number];

/**
 * What each state may PAINT on a pin. Named once so the pin, the tests and the
 * PR body cannot drift apart about it. Captain's law (5 Sept 2026): colour on a
 * pin is the price band alone, so a trust state is a badge SHAPE and never a
 * colour.
 *
 *   authority  the band and the printed figure come from the drop; `confirmed`
 *              adds the hollow ring badge, `corroborated` adds nothing.
 *   mark       the provisional dot and nothing else; band and figure stay
 *              whatever the curated data says.
 *   none       the drop lane paints nothing.
 */
export type PintTrustPinPaint = "authority" | "mark" | "none";
export const PINT_TRUST_PIN_PAINT: Record<PintTrustState, PintTrustPinPaint> = {
  confirmed: "authority",
  corroborated: "authority",
  // A split pub has reports but no agreed figure, so it wears the same mark one
  // report wears and reaches no band. Painting either figure would publish a
  // price half the reporters here did not pay.
  disputed: "mark",
  "logged-once": "mark",
  // Captain decision 9 (1 Nov 2026): a typed price with no bill does not touch
  // the pin until a second drinker agrees. Not the band, and not the mark
  // either: the mark is what the bill buys a lone report, and the composer's
  // one line about the bill says exactly that (RECEIPT_OPTIONAL_LINE).
  unchecked: "none",
  "aged-out": "none",
  none: "none",
};

/**
 * The one line each drop-lane state prints beside its figure, or null where
 * the surface prints something richer (the trust pill on `confirmed`, the
 * "Latest price from a drinker" row on `corroborated`) or nothing (`none`).
 */
export const PINT_TRUST_LINE: Record<PintTrustState, string | null> = {
  confirmed: null,
  corroborated: null,
  // A split names its own figures, so its line is built from the reading rather
  // than typed here (`pintTrustSplitLine`). A fixed string could not say which
  // two prices a pub holds.
  disputed: null,
  "logged-once": PROVISIONAL_PRICE_LINE,
  // The line beside the figure. WHO logged it and that nobody has checked it
  // is `uncheckedPriceLine(handle)` (lib/venuePriceLane.ts), printed where the
  // surface names the drinker.
  unchecked: UNCHECKED_PRICE_LINE,
  "aged-out": AGED_PRICE_LINE,
  none: null,
};

export type PintTrustReading<D extends SummaryDrop = SummaryDrop> = {
  state: PintTrustState;
  /** The drop the state is read over, or null on `none`. */
  drop: D | null;
  priceGbp: number | null;
  /** Epoch ms the price was seen (the drop's own `createdAt`). */
  observedAtMs: number | null;
  /**
   * What lib/priceTier.ts takes for its `confirmed` input. Present on
   * `confirmed` alone: it carries the day the confirmation was minted, which is
   * the day the trust pill prints.
   */
  confirmedPrice: ConfirmedPriceInput | null;
  /**
   * The figures the pub's drinkers disagree about. Present on `disputed` alone,
   * where `priceGbp` is deliberately null: a split has no one figure, and
   * handing a surface either of them would publish a price half the reporters
   * did not pay.
   */
  split: PintPriceSplit | null;
};

const NONE: PintTrustReading<never> = {
  state: "none",
  drop: null,
  priceGbp: null,
  observedAtMs: null,
  confirmedPrice: null,
  split: null,
};

function epochOf(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** THE reading. Six lanes asked in order, strongest first. */
export function pintTrustFor<D extends SummaryDrop>(
  drops: readonly D[],
  now: number = Date.now(),
): PintTrustReading<D> {
  // Invalid and future-dated rows cannot describe a price a drinker paid.
  drops = drops.filter((drop) => {
    const observedAt = Date.parse(drop.createdAt);
    return Number.isFinite(observedAt) && observedAt <= now
      && typeof drop.priceGbp === "number" && Number.isFinite(drop.priceGbp) && drop.priceGbp > 0;
  });
  const confirmed = confirmedPriceDrop(drops, now);
  if (confirmed) {
    return {
      state: "confirmed",
      drop: confirmed,
      priceGbp: confirmed.priceGbp as number,
      observedAtMs: epochOf(confirmed.createdAt),
      confirmedPrice: {
        priceGbp: confirmed.priceGbp as number,
        observedAt: (confirmed.confirmation as PintDropConfirmation).confirmedAt,
      },
      split: null,
    };
  }
  const corroborated = corroboratedPriceDrop(drops, now);
  if (corroborated) {
    return {
      state: "corroborated",
      drop: corroborated,
      priceGbp: corroborated.priceGbp as number,
      observedAtMs: epochOf(corroborated.createdAt),
      confirmedPrice: null,
      split: null,
    };
  }
  // ASKED BEFORE `logged-once`, because the provisional lane answers over a
  // split pub too: it hands back the freshest of the disagreeing drops, and
  // that is the reading that told Hatton's readers one drinker had spoken.
  const disputed = disputedPintPrices(drops, now);
  if (disputed) {
    return {
      state: "disputed",
      drop: disputed.drops[0] ?? null,
      priceGbp: null,
      observedAtMs: Number.isFinite(disputed.observedAtMs) ? disputed.observedAtMs : null,
      confirmedPrice: null,
      split: disputed.split,
    };
  }
  const provisional = provisionalPriceDrop(drops, now);
  if (provisional) {
    return {
      state: "logged-once",
      drop: provisional,
      priceGbp: provisional.priceGbp as number,
      observedAtMs: epochOf(provisional.createdAt),
      confirmedPrice: null,
      split: null,
    };
  }
  // BELOW a report with a bill and ABOVE one past the window: it is this
  // month's figure, and it has not been checked (captain decision 9).
  const unchecked = uncheckedPriceDrop(drops, now);
  if (unchecked) {
    return {
      state: "unchecked",
      drop: unchecked,
      priceGbp: unchecked.priceGbp as number,
      observedAtMs: epochOf(unchecked.createdAt),
      confirmedPrice: null,
      split: null,
    };
  }
  const aged = agedPriceDrop(drops, now);
  if (aged) {
    return {
      state: "aged-out",
      drop: aged,
      priceGbp: aged.priceGbp as number,
      observedAtMs: epochOf(aged.createdAt),
      confirmedPrice: null,
      split: null,
    };
  }
  return NONE;
}

/**
 * The drop-lane fields of a `VenueSignal`, projected from ONE reading so the
 * authority figure, the confirmation, the provisional figure and the aged
 * figure can never be read over different drops.
 */
export type PintTrustSignalFields = {
  pintTrust: PintTrustState;
  latestContributorPrice: number | null;
  latestContributorAt: number | null;
  confirmedPrice: ConfirmedPriceInput | null;
  provisionalContributorPrice: number | null;
  provisionalContributorAt: number | null;
  agedContributorPrice: number | null;
  agedContributorAt: number | null;
  /**
   * The public handle behind the provisional or aged figure when that figure
   * has NO BILL (captain decision 9), or null. It rides beside the figure it
   * names, so a surface prints "Logged by @handle, not checked" and keeps the
   * band off without reading the drops again.
   */
  uncheckedBy: string | null;
  /** The disagreeing figures and how many drinkers reported them, or null. */
  disputedPrices: PintPriceSplit | null;
  /** Epoch ms of the freshest drop in the split, or null. */
  disputedAt: number | null;
};

export function pintTrustSignalFields(reading: PintTrustReading): PintTrustSignalFields {
  const authority = PINT_TRUST_PIN_PAINT[reading.state] === "authority";
  // An unchecked report fills the SAME two provisional fields a billed one
  // does: both are this month's lone report, and the sheet prints both in the
  // provisional slot. `uncheckedBy` is what tells the two apart downstream.
  const loggedOnce = reading.state === "logged-once" || reading.state === "unchecked";
  const disputed = reading.state === "disputed";
  const aged = reading.state === "aged-out";
  const uncheckedBy =
    (loggedOnce || aged) && isUncheckedPrice(reading.drop) ? (reading.drop?.handle ?? "") : null;
  return {
    pintTrust: reading.state,
    latestContributorPrice: authority ? reading.priceGbp : null,
    latestContributorAt: authority ? reading.observedAtMs : null,
    confirmedPrice: reading.confirmedPrice,
    provisionalContributorPrice: loggedOnce ? reading.priceGbp : null,
    provisionalContributorAt: loggedOnce ? reading.observedAtMs : null,
    agedContributorPrice: aged ? reading.priceGbp : null,
    agedContributorAt: aged ? reading.observedAtMs : null,
    uncheckedBy,
    // A split reaches the two fields below and NOTHING else. It may not fill the
    // provisional pair, which is what let one of two disagreeing figures print
    // as the pub's one report.
    disputedPrices: disputed ? reading.split : null,
    disputedAt: disputed ? reading.observedAtMs : null,
  };
}

/**
 * A split and the day it was last reported, as `venuePriceLane` takes them, or
 * null. The split-lane twin of `dropLaneInput`, so the peek and the sheet build
 * one input the same way.
 */
export function splitLaneInput(
  split: PintPriceSplit | null | undefined,
  observedAtMs: number | null | undefined,
): DisputedPriceInput | null {
  return split ? { split, observedAt: observedAtMs ?? null } : null;
}

/**
 * A drop-lane figure and its day as `venuePriceLane` takes them, or null
 * when the signal holds none. One helper so the sheet and the phone peek
 * build the lane input the same way, and neither carries the branch.
 */
export function dropLaneInput(
  priceGbp: number | null | undefined,
  observedAtMs: number | null | undefined,
  /** The signal's `uncheckedBy`: present only when the figure has no bill. */
  uncheckedBy?: string | null,
): ProvisionalPriceInput | null {
  if (priceGbp == null) return null;
  return {
    priceGbp,
    observedAt: observedAtMs ?? null,
    ...(typeof uncheckedBy === "string" ? { uncheckedBy } : {}),
  };
}

/** The drop-lane fields of a signal, as a map signal carries them (each optional). */
export type DropLaneSignal = {
  provisionalContributorPrice?: number | null;
  provisionalContributorAt?: number | null;
  agedContributorPrice?: number | null;
  agedContributorAt?: number | null;
  uncheckedBy?: string | null;
  disputedPrices?: PintPriceSplit | null;
  disputedAt?: number | null;
};

/**
 * ALL THREE drop-lane inputs `venuePriceLane` takes, built from one signal.
 * The sheet and the phone peek both call this, so `uncheckedBy` cannot ride
 * one surface's figure and miss the other's (captain decision 9).
 */
export function dropLaneInputsFor(signal: DropLaneSignal | null | undefined): {
  provisional: ProvisionalPriceInput | null;
  aged: ProvisionalPriceInput | null;
  disputed: DisputedPriceInput | null;
} {
  if (!signal) return { provisional: null, aged: null, disputed: null };
  return {
    provisional: dropLaneInput(
      signal.provisionalContributorPrice,
      signal.provisionalContributorAt,
      signal.uncheckedBy,
    ),
    aged: dropLaneInput(signal.agedContributorPrice, signal.agedContributorAt, signal.uncheckedBy),
    disputed: splitLaneInput(signal.disputedPrices, signal.disputedAt),
  };
}

/**
 * The standing a pin's price tag wears from the drop lane alone: `confirmed`
 * when the reading is, else nothing. A pin knows no bundle, so this is the
 * only standing the map can stamp for itself; a caller holding a full
 * `PriceStandingDecision` passes that instead and this is not asked.
 */
export function pintTrustPinStanding(state: PintTrustState | null | undefined): PriceStanding | null {
  return state === "confirmed" ? "confirmed" : null;
}

/**
 * The trust state a rendered price lane is IN, for the `data-pint-trust`
 * attribute the Overview chip and the phone peek carry. The two drop lanes
 * name their state outright; the contributor lane is `confirmed` only when the
 * standing lib/priceTier.ts decided says so, else `corroborated`. Every other
 * lane is not a drop and answers null.
 *
 * That attribute is the hook the confirm action mounts against, so the two
 * halves of the second-drinker loop can land in either order.
 */
export function trustChipStateFor(
  lane: VenuePriceLane | null,
  standing: PriceStanding,
): PintTrustState | null {
  if (!lane) return null;
  switch (lane.lane) {
    case "contributor":
      return standing === "confirmed" ? "confirmed" : "corroborated";
    // ONE SLOT, TWO STATES: a lone report with a bill is `logged-once`, and
    // one typed without a bill is `unchecked` (captain decision 9).
    case "provisional":
      return venuePriceLaneUncheckedBy(lane) !== null ? "unchecked" : "logged-once";
    case "disputed":
      return "disputed";
    case "aged":
      return "aged-out";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// THE OVERVIEW'S ONE PRICE DOOR.
//
// Captain's rule (core-loop battle test L03, 5 Sept 2026): one button system,
// one clear primary per screen. The venue Overview used to offer four to
// eight price actions on one sheet, because every block that touched a price
// grew its own invitation: the first-drop nudge and its "Or leave a Pint
// Drop", the prices-by-drink invite, the second drinker's door, the sticky
// bar's "Add price" and an always-open composer with its chips. This table
// is the whole policy: each trust state names EXACTLY ONE primary door, and
// every other price action folds into the composer that door opens.
//
//   log      opens the pub's own price composer in place (the community price
//            form on the Overview, soft-gated by the account rules the sheet
//            already applies). The composer stays FOLDED until this door is
//            taken, so its Log it and its chips are never a second primary.
//   confirm  the second drinker's door (#1492): "Still £4.50?", seeding the
//            Pint Drop composer with the figure the lane prints, on the states
//            that are owed a second drinker (lib/pintDropSecondDrinker.ts).
//   choose   the SPLIT's door (captain 7 Sept 2026): "Which did you pay?" over
//            one button per recorded figure. A pub holding £4.50 and £4.70
//            cannot be asked "Still £4.70?", because that names one of two
//            answers and calls the other one a correction. Each button seeds
//            the composer with its own figure through the same seam the confirm
//            door uses, and the server decides what the answer was worth.
//
// Nothing here decides a figure, a colour or a standing: the label is worded
// over the lane's own observed figure, and the door wears the brass action
// treatment rather than a band, because a door is not a price.
// ---------------------------------------------------------------------------

/** The three door kinds. A surface renders the one it is handed and no other. */
export type OverviewPriceDoorKind = "log" | "confirm" | "choose";

/** ONE door per state. Written once so the sheet, the tests and the PR body agree. */
export const OVERVIEW_PRICE_DOOR_KIND: Record<PintTrustState, OverviewPriceDoorKind> = {
  confirmed: "log",
  corroborated: "log",
  disputed: "choose",
  "logged-once": "confirm",
  // A second drinker's agreeing report is exactly what an unchecked price is
  // waiting for, so it is offered the same door: "Still £4.50?".
  unchecked: "confirm",
  "aged-out": "confirm",
  none: "log",
};

/** The one label the log door prints, everywhere it prints. */
export const LOG_PRICE_DOOR_LABEL = "Log tonight's price";

/** The one question the split's door asks. */
export const CHOOSE_PRICE_DOOR_LABEL = "Which did you pay?";

export type OverviewPriceDoor =
  | { kind: "log"; label: string }
  | { kind: "confirm"; label: string; priceGbp: number }
  | { kind: "choose"; label: string; prices: number[] };

/**
 * The door the Overview's price area offers over a decided lane, or null where
 * no price action belongs at all (an anchor lane: a cocktail or a course is
 * not a pint, and the caller already refuses a venue that is not a pub).
 *
 * A confirm state whose lane carries no figure (which the lane table does not
 * produce, but the type allows) falls back to the log door rather than to
 * nothing, because a pub with a public drop and no way to answer it is the
 * defect this door exists to close.
 */
export function overviewPriceDoor(
  state: PintTrustState | null,
  lane: VenuePriceLane | null,
): OverviewPriceDoor | null {
  if (lane?.lane === "anchor") return null;
  const kind = OVERVIEW_PRICE_DOOR_KIND[state ?? "none"];
  if (kind === "choose" && lane?.lane === "disputed") {
    return { kind: "choose", label: CHOOSE_PRICE_DOOR_LABEL, prices: lane.split.prices };
  }
  if (kind === "confirm" && lane) {
    const figure = venuePriceLaneObservedGbp(lane);
    if (figure !== null) {
      return { kind: "confirm", label: confirmPintActionLabel(figure), priceGbp: figure };
    }
  }
  return { kind: "log", label: LOG_PRICE_DOOR_LABEL };
}
