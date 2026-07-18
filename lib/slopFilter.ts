// Slop filter for scraped third-party venue descriptions.
//
// data/borough_embedded_pint_prices.json carries a `description` field that was
// machine-generated from chain listings — of ~693 unique descriptions, the vast
// majority are AI marketing filler ("Welcome to the X pub!", "vibrant
// atmosphere", "Whether you're looking to..."). Rendering that verbatim on a
// venue's story tab reads as slop and undercuts the honest, sourced voice the
// rest of the product carries.
//
// This module is the guard at the render seam: a description that trips any tell
// below renders NOTHING, and the honest empty state ("No heritage note yet...")
// takes over. It never edits the data file — it only decides what to show.
//
// Design: high-precision substring tells (case-insensitive) plus an
// "exclamation-led opener" test. The tells are chosen to catch the marketing
// register without nuking the minority of descriptions that carry a genuine,
// specific fact (a founding date, a listed-building status, a real story) — so
// e.g. "…one of the oldest in London, dating back over 500 years" survives while
// "Welcome to the Prince Albert! …vibrant atmosphere" is filtered.

// Marketing / filler phrases. All matched case-insensitively as substrings, so
// "whether you" covers "whether you're", "whether you are", "whether you want".
export const SLOP_PHRASES = [
  // Required tells (from the audit).
  "whether you",
  "welcome to",
  "vibrant",
  "nestled",
  "boasts",
  "perfect spot",
  "unwind",
  // Additional high-precision filler tells found by sampling the dataset. These
  // are pure marketing boilerplate that (unlike broad adjectives such as
  // "cozy"/"charming"/"delicious") rarely co-occur with a real, specific fact.
  "for your entertainment",
  "something for everyone",
  "look no further",
  "hidden gem",
  "must-visit",
  "must visit",
  "wide selection of food and drinks",
  "plan your visit today",
] as const;

// An "exclamation-led opener": the first sentence ends on a "!" — the tell-tale
// tour-guide shout ("Welcome to The Greyhound Pub in Kensington!"). Anchored to
// the start and stopping at the first sentence terminator, so a "!" buried deep
// in an otherwise plain description does not trip it.
const EXCLAMATION_OPENER = /^\s*[^.!?]{0,160}!/;

/**
 * True when a scraped description reads as AI marketing slop and should not be
 * rendered. Empty / whitespace / nullish input is not slop (there is simply
 * nothing to show) — callers distinguish "no description" from "slop" via
 * {@link presentableDescription}.
 */
export function isSlopDescription(input: string | null | undefined): boolean {
  if (!input) return false;
  const text = input.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (SLOP_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (EXCLAMATION_OPENER.test(text)) return true;
  return false;
}

/**
 * The description to actually render, or null when there is nothing worth
 * showing. Returns the trimmed description when it is present and passes the
 * slop filter; returns null for missing/empty descriptions AND for slop, so the
 * caller's honest empty state takes over in both cases.
 */
export function presentableDescription(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;
  return isSlopDescription(text) ? null : text;
}
