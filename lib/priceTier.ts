// What a price surface may CLAIM about one pub's pint, and nothing about how
// that claim looks.
//
// FOUR STANDINGS, AND THE GAP BETWEEN TWO OF THEM IS THE WHOLE POINT. A
// `listed` price was published by a public source and carries the URL and
// the day it was read. An `estimate` was MODELLED here and was never published
// by anybody, so it may never be printed as a bare figure: it says "est. £X",
// it carries the basis it was modelled from, and it links to the method. A
// surface that formats a standing's price itself can drop that "est.", which is
// why `priceStandingFigure` is the ONE place a figure becomes a string.
//
// A `confirmed` input comes from the community confirmation path. A public
// publisher URL and its read timestamp do not supply community confirmation.
//
// This module imports one leaf formatter and nothing else, so a surface that
// needs a standing does not pull the venue index in behind it.

import { formatGbp } from "@/lib/formatGbp";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The closed set, weakest claim last. A surface narrows FROM this list; it
 * never restates it, because a standing added in one place and missed in
 * another is how an estimate starts reading as a published price.
 */
export const PRICE_STANDINGS = ["confirmed", "listed", "estimate", "none"] as const;
export type PriceStanding = (typeof PRICE_STANDINGS)[number];

/**
 * A confirmation is only a confirmation while it is recent. This is the same
 * 30 days the community price window already uses (lib/priceAuthorityWindow),
 * restated as days here because this module is a leaf on purpose.
 */
export const CONFIRMED_MAX_AGE_DAYS = 30;

/**
 * A published menu price ages too. The captain's brief set no ceiling on the
 * listed standing, and shipping none would let a two-year-old menu read as
 * today's price, so one is applied: past this age a listed price stops being
 * listed and falls through to whatever weaker standing the pub can support.
 * It is a year rather than the confirmation's month because a chain menu is
 * republished on its own slow cadence, not on a drinker's visit.
 */
export const LISTED_MAX_AGE_DAYS = 365;

/** Why a pub landed on the standing it did. Surfaces may word this; none may re-derive it. */
type PriceStandingReason =
  | "confirmed_in_window"
  | "confirmation_expired"
  | "listed_with_source"
  | "listed_expired"
  | "modelled"
  | "nothing_known";

/** A price somebody confirmed through the community confirmation path. */
export type ConfirmedPriceInput = {
  priceGbp: number;
  observedAt: string;
};

/** A publicly listed price, with its source link and the day that source was read. */
export type ListedPriceInput = {
  priceGbp: number;
  sourceUrl: string;
  observedAt: string;
  publisher?: string | null;
};

/**
 * A price nobody published. `basis`, `sampleSize` and `computedAt` are not
 * decoration: they are what makes the estimate answerable, and validate-data
 * refuses an estimate row without them.
 */
export type EstimatedPriceInput = {
  priceGbp: number;
  basis: string;
  sampleSize: number;
  computedAt: string;
};

export type PriceStandingInput = {
  confirmed?: ConfirmedPriceInput | null;
  listed?: ListedPriceInput | null;
  estimate?: EstimatedPriceInput | null;
};

export type PriceStandingDecision = {
  standing: PriceStanding;
  reason: PriceStandingReason;
  priceGbp: number | null;
  /** Present only on `listed`, because only a listed price has one to show. */
  sourceUrl: string | null;
  /** The day the figure was observed or modelled. Absent on `none`. */
  asOf: string | null;
  /** Present only on `estimate`. */
  basis: string | null;
  /** Present only on `estimate`. */
  sampleSize: number | null;
};

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function ageDays(observedAt: string, now: number): number | null {
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return null;
  return (now - ms) / DAY_MS;
}

/** A price observed in the future is not evidence about today; it is a bad row. */
function withinWindow(observedAt: string, maxAgeDays: number, now: number): boolean {
  const age = ageDays(observedAt, now);
  return age !== null && age >= 0 && age <= maxAgeDays;
}

const NOTHING: PriceStandingDecision = {
  standing: "none",
  reason: "nothing_known",
  priceGbp: null,
  sourceUrl: null,
  asOf: null,
  basis: null,
  sampleSize: null,
};

/**
 * THE ONE decision. Strongest claim the evidence supports, never stronger.
 *
 * An expired confirmation or an expired listing does not become an estimate by
 * itself; it falls through, and the pub takes whatever standing its own
 * remaining evidence supports. That is why the reason is reported: a pub with
 * an expired listing and a modelled figure reads as an estimate, and a caller
 * that wants to say the listing went stale still can.
 */
export function priceStandingFor(
  input: PriceStandingInput,
  now: number = Date.now(),
): PriceStandingDecision {
  let fallbackReason: PriceStandingReason | null = null;

  const confirmed = input.confirmed;
  if (confirmed && isFinitePrice(confirmed.priceGbp)) {
    if (withinWindow(confirmed.observedAt, CONFIRMED_MAX_AGE_DAYS, now)) {
      return {
        standing: "confirmed",
        reason: "confirmed_in_window",
        priceGbp: confirmed.priceGbp,
        sourceUrl: null,
        asOf: confirmed.observedAt,
        basis: null,
        sampleSize: null,
      };
    }
    fallbackReason = "confirmation_expired";
  }

  const listed = input.listed;
  if (listed && isFinitePrice(listed.priceGbp) && isPublicHttpUrl(listed.sourceUrl)) {
    if (withinWindow(listed.observedAt, LISTED_MAX_AGE_DAYS, now)) {
      return {
        standing: "listed",
        reason: "listed_with_source",
        priceGbp: listed.priceGbp,
        sourceUrl: listed.sourceUrl,
        asOf: listed.observedAt,
        basis: null,
        sampleSize: null,
      };
    }
    fallbackReason = "listed_expired";
  }

  const estimate = input.estimate;
  if (
    estimate &&
    isFinitePrice(estimate.priceGbp) &&
    typeof estimate.basis === "string" &&
    estimate.basis.trim().length > 0 &&
    Number.isInteger(estimate.sampleSize) &&
    estimate.sampleSize > 0 &&
    Number.isFinite(Date.parse(estimate.computedAt))
  ) {
    return {
      standing: "estimate",
      reason: "modelled",
      priceGbp: estimate.priceGbp,
      sourceUrl: null,
      asOf: estimate.computedAt,
      basis: estimate.basis,
      sampleSize: estimate.sampleSize,
    };
  }

  return fallbackReason ? { ...NOTHING, reason: fallbackReason } : NOTHING;
}

/**
 * A drinker's log uses the confirmation clock. A publicly listed price uses
 * the listing clock. Both clocks use the standings' own windows, never a second pair.
 */
export type PriceAgeLane = "drinker" | "published";

/** Fresh while its window holds; aging past it, or with no read day at all. */
export type PriceAge = "fresh" | "aging";

/**
 * Whether a figure a surface prints is still inside the window its standing
 * claims (owner decision 16 Oct 2026: "an aging price must look aging, never
 * fresh"). A drinker's log is fresh for CONFIRMED_MAX_AGE_DAYS and a published
 * price for LISTED_MAX_AGE_DAYS. A figure with no read day, or a read day in
 * the future, cannot claim to be fresh, so it is aging. Colour stays the band's
 * alone: a surface says aging with its shape and its words, never its hue.
 */
export function priceAgeFor(
  lane: PriceAgeLane,
  observedAt: string | number | null | undefined,
  now: number = Date.now(),
): PriceAge {
  if (observedAt === null || observedAt === undefined || observedAt === "") return "aging";
  if (typeof observedAt === "number" && !Number.isFinite(observedAt)) return "aging";
  const iso = typeof observedAt === "number" ? new Date(observedAt).toISOString() : observedAt;
  const window = lane === "drinker" ? CONFIRMED_MAX_AGE_DAYS : LISTED_MAX_AGE_DAYS;
  return withinWindow(iso, window, now) ? "fresh" : "aging";
}

/**
 * The words an aging figure carries beside it, so the shape is never alone.
 * Each says only what the read day shows: a date that cannot be read, or one
 * later than today, is not evidence of an old price, so it is not called one.
 */
export function priceAgeNote(
  lane: PriceAgeLane,
  observedAt: string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (observedAt === null || observedAt === undefined || observedAt === "") {
    return "No read date on record, so this price may have changed.";
  }
  const age =
    typeof observedAt === "number"
      ? Number.isFinite(observedAt)
        ? (now - observedAt) / DAY_MS
        : null
      : ageDays(observedAt, now);
  if (age === null || age < 0) {
    return "The read date on record cannot be checked, so this price may have changed.";
  }
  return lane === "drinker"
    ? `Logged over ${CONFIRMED_MAX_AGE_DAYS} days ago, so this price may have changed.`
    : "Read over a year ago, so this price may have changed.";
}

// A standing has NO TONE. It used to (green confirmed, amber listed, blue
// modelled, grey none) and the captain saw a green "Confirmed" over a dear
// pint. Captain's law 2026-09-05: colour on a price is its BAND
// (lib/priceBand.ts) and nothing else, and a standing says what it is in the
// word, the note and the figure's own "est." prefix.

/** The short word a pill wears. */
export function priceStandingLabel(standing: PriceStanding): string {
  switch (standing) {
    case "confirmed":
      return "Confirmed";
    case "listed":
      return "Listed";
    case "estimate":
      return "Estimated";
    case "none":
      return "No price yet";
  }
}

/** One sentence saying what the standing means, for the pill's own title. */
export function priceStandingNote(standing: PriceStanding): string {
  switch (standing) {
    case "confirmed":
      return `A drinker confirmed this price in the last ${CONFIRMED_MAX_AGE_DAYS} days.`;
    case "listed":
      return "A public source lists this price. Its source and read day are shown when recorded.";
    case "estimate":
      return "Nobody has published this price. We modelled it, and it is not a quote.";
    case "none":
      return "This record does not support a current confirmed or listed price.";
  }
}

/** Where the estimate method is written down for a reader. */
export const HOW_WE_ESTIMATE_HREF = "/how-we-estimate";

/** The link text beside an estimate. */
export const HOW_WE_ESTIMATE_LABEL = "How we estimate";

/**
 * THE ONE place a standing's figure becomes a string, so no surface can print a
 * modelled price as though the pub had published it. `none` has no figure, and
 * says so by answering null rather than an empty string a caller might render.
 */
export function priceStandingFigure(decision: PriceStandingDecision): string | null {
  if (decision.priceGbp === null) return null;
  const figure = formatGbp(decision.priceGbp);
  return decision.standing === "estimate" ? `est. ${figure}` : figure;
}

/**
 * Whether this standing may reach a surface that speaks with authority: the pin
 * price label, the cheapest-pint buckets, the Pint Index, any current-price
 * merge. An estimate may NOT, for the same reason a historical price may not:
 * it is not an observation of tonight, and a modelled figure inside a citable
 * lane would be a number nobody can correct.
 */
export function standingCarriesAuthority(standing: PriceStanding): boolean {
  return standing === "confirmed" || standing === "listed";
}
