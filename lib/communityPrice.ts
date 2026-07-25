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

/** One community-submitted price observation, as stored and as returned. */
export type CommunityPrice = {
  venueId: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  /** Epoch ms the observation was recorded (server clock, never the client's). */
  submittedAt: number;
  /** Always "community" - the provenance lane this price lives in. */
  source: "community";
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
