// BROWSER-SAFE core of the community price-submission domain - "I'm in this pub
// and a pint is £4.20 tonight". Pure: no server imports, no node builtins, so
// the submit UI and the API route share ONE validator and can never drift
// (same split as lib/pintDropShared.ts under lib/pintDrops.ts).
//
// What a community price IS: a dated, sourced observation a drinker made
// tonight, attached to (venue, drink category), carrying `source: "community"`.
// What it is NOT: an edit of the dataset. It NEVER overwrites the scraped /
// sourced baseline - both stand, each with its own dated badge, per the
// app-wide rule that provenance is never flattened away (CONTEXT.md).
//
// The confirm signal (lib/priceConfirmStore.ts) counts vouches for a price that
// is ALREADY displayed. This module is its sibling: the first time a price is
// SUBMITTED. Together they are the whole community price loop.

import { CATEGORY_META, isDrinkCategory, type DrinkCategory } from "@/lib/drinks";

/**
 * Plausible-price envelope for a UK drink, in GBP. Below the floor is a
 * fat-fingered entry (£4.50 typed as £0.45); above the ceiling is a typo or
 * noise, not an observation. Wider than the Pint Drop £1–£20 pint window
 * because this surface accepts every category - a round of cocktails or an
 * aged whisky can honestly clear £20.
 */
export const COMMUNITY_PRICE_MIN_GBP = 1;
export const COMMUNITY_PRICE_MAX_GBP = 30;

/** Venue ids are the slim-index stable ids; cap them like every other writer. */
const MAX_VENUE_ID = 64;

/**
 * The categories offered on the submit surface, in tap order. A deliberate
 * subset of DRINK_CATEGORIES: the drinks someone actually reads a price for off
 * a pub board. `other` is the honest catch-all so nothing is unrepresentable.
 * The server still accepts any DrinkCategory - this list is the UI's shortcut,
 * not a second allowlist.
 */
export const SUBMITTABLE_DRINK_CATEGORIES: readonly DrinkCategory[] = [
  "beer",
  "wine",
  "cocktail",
  "whisky",
  "other",
];

/** The default category the submit surface opens on - a pub is a pint first. */
export const DEFAULT_SUBMIT_CATEGORY: DrinkCategory = "beer";

/**
 * The MAP's candidate figure for a drink category: the best-corroborated
 * in-window report, which is not necessarily the freshest one. The sheet shows
 * the freshest row; the map paints this one, so a lone fresh disagreement can
 * neither repaint the map nor un-paint an already-corroborated figure - only a
 * contradiction that itself reaches the threshold takes the map over. Derived
 * on the store's read path from the same per-(venue, category, actor) rows as
 * `corroborations`; never stored, never client-supplied.
 */
export type CommunityPriceMapCandidate = {
  priceGbp: number;
  /** Epoch ms of the candidate cluster's freshest agreeing report. */
  submittedAt: number;
  /** Independent submitters backing the candidate figure. */
  corroborations: number;
};

/** One community-submitted price observation, as stored and as returned. */
export type CommunityPrice = {
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  /** Epoch ms the observation was recorded (server clock, never the client's). */
  submittedAt: number;
  /** Always "community" - the provenance lane this price lives in. */
  source: "community";
  /**
   * How many INDEPENDENT submitters agree with this figure, counting the one
   * who logged it - so a lone report is 1. Derived on the read path from the
   * per-(venue, category, actor) rows the store already holds; never stored,
   * never client-supplied. Absent means "unknown", read as 1 (the cautious
   * reading: an unknown-provenance figure has not earned the map).
   */
  corroborations?: number;
  /**
   * The category's best-corroborated in-window figure, riding alongside the
   * freshest (sheet) row this object is. Absent when the category has no
   * in-window report at all - the cautious reading falls back to the row
   * itself, which the age gate then refuses anyway.
   */
  mapCandidate?: CommunityPriceMapCandidate;
};

/** The normalised, trusted shape a validated submission becomes. */
export type CommunityPriceInput = {
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
};

export type CommunityPriceValidation =
  | { ok: true; value: CommunityPriceInput }
  | { ok: false; error: string };

/** Human label for a category, reusing the one drinks vocabulary. */
export function submitCategoryLabel(category: DrinkCategory): string {
  return CATEGORY_META[category].label;
}

/** Parse a number from a JSON body or a form field; null when not a number. */
function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // Tolerate what a phone keypad produces: "£4.20", " 4.20", "4,20".
    const cleaned = value.replace(/[£\s]/g, "").replace(",", ".");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, MAX_VENUE_ID);
}

/** Round GBP to whole pennies - the only precision a price has. */
export function roundToPennies(priceGbp: number): number {
  return Math.round(priceGbp * 100) / 100;
}

/**
 * Trust boundary for a submitted price. Shared by the client (instant, friendly
 * feedback before any network hop) and the route (the authoritative check -
 * the client's verdict is never trusted). Error copy is reader-facing: it says
 * what a real price looks like rather than naming a constraint.
 */
export function validateCommunityPrice(input: unknown): CommunityPriceValidation {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;

  const venueId = cleanVenueId(raw.venueId);
  if (!venueId) return { ok: false, error: "A venue is required." };

  const category = typeof raw.drinkCategory === "string" ? raw.drinkCategory.trim().toLowerCase() : "";
  if (!isDrinkCategory(category)) {
    return { ok: false, error: "Pick what you're drinking." };
  }

  const parsed = readNumber(raw.priceGbp);
  if (parsed === null) {
    return { ok: false, error: "Type tonight's price, like 4.20." };
  }
  if (parsed < COMMUNITY_PRICE_MIN_GBP) {
    // A sub-£1 entry is almost always a dropped digit (£4.50 typed as £0.45),
    // so offer the ×10 reading back when it lands inside the envelope.
    const likely = roundToPennies(parsed * 10);
    const hint =
      likely >= COMMUNITY_PRICE_MIN_GBP && likely <= COMMUNITY_PRICE_MAX_GBP
        ? ` Did you mean £${likely.toFixed(2)}?`
        : "";
    return { ok: false, error: `Under £${COMMUNITY_PRICE_MIN_GBP} isn't a pub price.${hint}` };
  }
  if (parsed > COMMUNITY_PRICE_MAX_GBP) {
    return {
      ok: false,
      error: `£${COMMUNITY_PRICE_MAX_GBP} is our ceiling for one drink. Double-check that one?`,
    };
  }

  return {
    ok: true,
    value: { venueId, drinkCategory: category, priceGbp: roundToPennies(parsed) },
  };
}

const DAY_MS = 86_400_000;

// ── Trust policy: what an anonymous figure has to earn before it moves the map ─
//
// Captain decision 2026-07-26 (community-price-trust-model / -max-age), closing
// review findings F1 (product half) and F4. TWO gates, both pure read-side
// policy over rows the store already keeps - nothing new is written, and the
// pub's own sheet is never gated: a submission ALWAYS shows there, dated, from
// the first tap. What the gates protect is the MAP - pin colour, list rows and
// the cheapest buckets - where one anonymous device could otherwise repaint
// every pub in London permanently (F1) with a figure that never ages out (F4).
//
// The whole policy lives here, browser-safe, so the store that counts it, the
// merge that enforces it and the copy that explains it read the same constants.

/**
 * Independent submitters needed before a community price drives the map. Two
 * is the smallest number that is not "one stranger's word": it takes a second
 * device, in the same pub, agreeing about the same drink.
 */
export const COMMUNITY_PRICE_CORROBORATION_THRESHOLD = 2;

/**
 * How long a community price keeps the map after it was logged. Beyond this the
 * map falls back to the scraped/sourced baseline (or a Pint Drop) while the
 * sheet keeps the dated row - the observation was true, it is just no longer
 * evidence about tonight. 30 days is a pub's realistic price-change horizon.
 */
export const COMMUNITY_PRICE_MAX_AGE_MS = 30 * DAY_MS;

/**
 * Agreement window between two reports of the same drink at the same pub:
 * whichever is wider of 50p and 10% of the figure being corroborated.
 *
 * Both halves earn their place. The 50p FLOOR carries the pint case, where a
 * strict percentage is too mean: two honest drinkers at a £4.20 pub routinely
 * report £4.20 and £4.50 (board price vs till price, a different pump, a
 * rounding). 10% of £4.20 is 42p, which would reject that pair and leave the
 * feature never corroborating anything. The 10% FRACTION carries the top of the
 * envelope, where 50p is too mean instead: an £18 cocktail and an £18.90 one
 * are plainly the same drink, and the ceiling is £30. Taking the wider of the
 * two is deliberate - the failure mode we care about is a real corroboration
 * being refused, not two nearby-but-different drinks agreeing, because the
 * category is already pinned and both reports still have to be independent.
 */
export const COMMUNITY_PRICE_AGREEMENT_FLOOR_GBP = 0.5;
export const COMMUNITY_PRICE_AGREEMENT_FRACTION = 0.1;

/** Whole pennies - the only precision a price has, and the only one worth comparing in. */
function pennies(priceGbp: number): number {
  return Math.round(priceGbp * 100);
}

/**
 * Does `other` corroborate `reference`? Directional on purpose: the window is
 * sized off the figure being corroborated (the freshest report), not off some
 * symmetric midpoint, so the same reference always accepts the same band.
 * Compared in integer pennies - `4.7 - 4.2` is 0.5000000000000004 in binary
 * floating point, and a tolerance test that fails on that would be a bug.
 */
export function agreesWithinTolerance(referenceGbp: number, otherGbp: number): boolean {
  if (!Number.isFinite(referenceGbp) || !Number.isFinite(otherGbp)) return false;
  const window = Math.max(
    pennies(COMMUNITY_PRICE_AGREEMENT_FLOOR_GBP),
    Math.round(pennies(referenceGbp) * COMMUNITY_PRICE_AGREEMENT_FRACTION),
  );
  return Math.abs(pennies(referenceGbp) - pennies(otherGbp)) <= window;
}

/** Has this figure been corroborated by a second independent submitter? */
export function isCorroborated(price: Pick<CommunityPrice, "corroborations">): boolean {
  return (price.corroborations ?? 1) >= COMMUNITY_PRICE_CORROBORATION_THRESHOLD;
}

/** Is this observation still recent enough to be evidence about tonight? */
export function isWithinMaxAge(
  price: Pick<CommunityPrice, "submittedAt">,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(price.submittedAt)) return false;
  return now - price.submittedAt <= COMMUNITY_PRICE_MAX_AGE_MS;
}

/**
 * THE gate. A community price drives the map - pin colour, list rows, cheapest
 * buckets - only when it is both corroborated and inside the age window. The
 * pub's own sheet deliberately does NOT consult this: it shows every submission,
 * dated, and explains its standing with `communityTrustNote` below.
 */
export function drivesMap(
  price: Pick<CommunityPrice, "corroborations" | "submittedAt">,
  now: number = Date.now(),
): boolean {
  return isCorroborated(price) && isWithinMaxAge(price, now);
}

/**
 * What the map would actually paint for this category: the best-corroborated
 * in-window figure when the store attached one, else the row itself (the
 * cautious fallback - a row with no candidate has no in-window backing, so the
 * age gate refuses it downstream). Resolving here, in the one vocabulary, is
 * what stops a lone fresh disagreement un-painting a corroborated price: the
 * sheet row and the map figure are allowed to differ, and every map-side
 * consumer must ask for the candidate rather than trusting the sheet row.
 */
export function mapCandidateOf(price: CommunityPrice): CommunityPrice {
  const candidate = price.mapCandidate;
  if (!candidate) return price;
  return {
    venueId: price.venueId,
    drinkCategory: price.drinkCategory,
    priceGbp: candidate.priceGbp,
    submittedAt: candidate.submittedAt,
    source: "community",
    corroborations: candidate.corroborations,
  };
}

/**
 * Is THIS figure the one painting the map right now? Stricter than `drivesMap`
 * on purpose - it is the receipt's question, and the receipt must never claim
 * map presence the figure does not have:
 *
 *   - only beer can restamp (pins and list rows are pint-priced surfaces);
 *   - the figure must BE the category's map candidate, not merely corroborated
 *     (a corroborated £4.20 stays on the map while your £9.00 waits);
 *   - the candidate must pass both map gates; and
 *   - a Pint Drop we know is newer outranks it in the merge, so it outranks
 *     the claim here too. An unknown drop age reads as "no newer drop", the
 *     same reading mergeCommunityPriceSignals takes.
 */
export function paintsMap(
  price: CommunityPrice,
  pintDropAt?: number | null,
  now: number = Date.now(),
): boolean {
  if (price.drinkCategory !== "beer") return false;
  const candidate = mapCandidateOf(price);
  if (pennies(candidate.priceGbp) !== pennies(price.priceGbp)) return false;
  if (!drivesMap(candidate, now)) return false;
  if (typeof pintDropAt === "number" && pintDropAt > candidate.submittedAt) return false;
  return true;
}

/**
 * The pre-submit promise about a category's REACH, kept per category so the
 * note can never promise the map to a drink the map does not price: pins, list
 * rows and cheapest buckets are pint surfaces, so only beer ever restamps.
 */
export function communityReachNote(category: DrinkCategory): string {
  return category === "beer"
    ? "It moves the map once a second drinker logs the same."
    : "The map prices pints, so it stays on this pub's page.";
}

/**
 * The sheet's honest one-liner about a price that is showing but not driving
 * the map, or "" when it needs no explanation. Sentence case per the
 * caps-are-stamps rule (DESIGN.md) - this is prose, not a stamp. Per-category
 * for the same honesty reason as `communityReachNote`: a wine or cocktail row
 * must not imply a map move that no amount of confirmation can deliver.
 */
export function communityTrustNote(
  price: Pick<CommunityPrice, "corroborations" | "submittedAt" | "drinkCategory">,
  now: number = Date.now(),
): string {
  const pint = price.drinkCategory === "beer";
  if (!isWithinMaxAge(price, now)) {
    return pint
      ? "Over 30 days old, so the map is back on the price on record."
      : "Over 30 days old - a record of that night, not tonight's price.";
  }
  if (!isCorroborated(price)) {
    return pint
      ? "Awaiting confirmation - it moves the map once someone else logs the same."
      : "Awaiting confirmation - a second report backs it up.";
  }
  return "";
}

/**
 * The dated half of the restamp: "today" / "yesterday" / "3 Jul". Deliberately
 * a DAY label, not a relative clock - a price is an observation of a night, and
 * "today" is the word that makes the map change feel like tonight's map.
 * Compared on London calendar days so a 00:30 submission still reads as the
 * day the drinker was in the pub.
 */
export function formatPriceDay(submittedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(submittedAt)) return "";
  const dayOf = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
  const submittedDay = dayOf(submittedAt);
  if (submittedDay === dayOf(now)) return "today";
  if (submittedDay === dayOf(now - DAY_MS)) return "yesterday";
  return new Date(submittedAt).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
}

/**
 * The restamp caption under a community price - "today · community". One
 * formatter so the pin callout, the venue card, and the submit confirmation
 * can never word the same fact differently.
 */
export function communityStampLabel(submittedAt: number, now: number = Date.now()): string {
  const day = formatPriceDay(submittedAt, now);
  return day ? `${day} · community` : "community";
}
