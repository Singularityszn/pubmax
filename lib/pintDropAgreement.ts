// Browser-safe LEAF. WHEN TWO PINT DROPS ARE ABOUT THE SAME PRICE.
//
// Captain 7 Sept 2026: "Two drinks and two prices. Let's say we look at it:
// reach, we check both." Grok read the 08:37 deploy and found the pub this
// module exists for: Hatton held two public drops, £4.50 and £4.70, and the
// Overview still said "Logged once, needs a second drinker" over a door
// offering "Still £4.70?". Two drinkers had spoken and the product reported
// one, because the drop lane asked `agreesWithinTolerance`
// (lib/communityPrice.ts), whose floor is 50p, so £4.50 and £4.70 counted as
// one figure a second drinker had backed.
//
// A DIFFERENT PRICE IS NOT CORROBORATION. This module is that one rule:
//
//   - two drops agree when they are about the SAME DRINK, the SAME MEASURE and
//     the SAME PENNIES. Nothing rounds, nothing widens, nothing scales.
//   - drops that do not agree are a SPLIT: two figures the pub really holds,
//     which is a fact to print rather than a tie to break.
//
// The 50p tolerance is untouched where it belongs, on `community_prices`
// (`mapCandidateOf`), which is a different lane with a different write door.
// This is the Pint Drop lane's own bar, and it is the stricter one because a
// Pint Drop names a drink, a measure and a receipt.
//
// Nothing here reads a clock or a window. The caller filters to the in-window
// public pint rows it trusts and hands them over; `lib/venues.ts` is the one
// caller that does that filtering.

import { CATEGORY_META } from "@/lib/drinks";
import { measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";

/**
 * The drink texts that NAME NO DRINK. The one-tap composer offers a closed
 * category and no free text, so it writes the lane's own label ("Beer") as the
 * drop's drink (`writeOneTapPintDrop`, lib/oneTapPintDrop.server.ts), while the
 * full Pint Drop composer writes whatever the drinker typed ("Guinness").
 *
 * Those two are not a disagreement about the drink: "Beer, £4.50" is a claim
 * about a pint of beer here, and "Guinness, £4.50" is a more specific claim of
 * the same figure. Reading them as two drinks would make a confirmation between
 * the product's two price doors impossible, which is a bar nobody asked for.
 */
const UNNAMED_DRINKS: ReadonlySet<string> = new Set(
  Object.values(CATEGORY_META).map((meta) => meta.label.toLowerCase()),
);

/** The minimum a row needs before this module can compare it with another. */
export type AgreeableDrop = {
  drink: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  priceGbp: number | null;
};

/** A price as whole pennies, so 4.5 and 4.50 are one figure and 4.5 and 4.7 are two. */
function pricePennies(priceGbp: number): number {
  return Math.round(priceGbp * 100);
}

/**
 * WHICH DRINK this drop names, or null when it names none.
 *
 * `drink` is free text a drinker types, so it is compared case-insensitively
 * with its whitespace collapsed and nothing else: "Guinness" and "guinness"
 * are one drink, and "Guinness" and "Guinness 0.0" are two, which is the honest
 * answer when we cannot ask. A blank text and a bare lane label name no drink
 * and answer null; see `UNNAMED_DRINKS`.
 */
export function drinkAgreementKey(drop: AgreeableDrop): string | null {
  const drink = drop.drink.trim().toLowerCase().replace(/\s+/g, " ");
  if (!drink || UNNAMED_DRINKS.has(drink)) return null;
  return drink;
}

/**
 * WHICH SERVING this drop is about. Always answers: an absent measure reads as
 * `pint`, and an `other` measure carries its own label, so a schooner and a
 * bottle never merge into one "other".
 */
function measureAgreementKey(drop: AgreeableDrop): string {
  const measure: DrinkMeasure = drop.measure ?? "pint";
  const label = measure === "other" ? (drop.measureLabel?.trim().toLowerCase() ?? "") : "";
  return `${measure}|${label}`;
}

/** Could these two drops be about one drink? A drop naming none could be either. */
export function drinksMayBeOne(a: AgreeableDrop, b: AgreeableDrop): boolean {
  if (measureAgreementKey(a) !== measureAgreementKey(b)) return false;
  const left = drinkAgreementKey(a);
  const right = drinkAgreementKey(b);
  return left === null || right === null || left === right;
}

/**
 * Do these two drops report the SAME price for the SAME drink?
 *
 * The one predicate behind a corroboration on the Pint Drop lane and behind a
 * minted confirmation, so the pin the browser paints and the record the server
 * writes cannot be decided two ways.
 */
export function pintDropsAgree(a: AgreeableDrop, b: AgreeableDrop): boolean {
  if (typeof a.priceGbp !== "number" || typeof b.priceGbp !== "number") return false;
  if (!Number.isFinite(a.priceGbp) || !Number.isFinite(b.priceGbp)) return false;
  if (pricePennies(a.priceGbp) !== pricePennies(b.priceGbp)) return false;
  return drinksMayBeOne(a, b);
}

/**
 * What a pub's drinkers actually said, when they did not say one thing.
 *
 * `prices` are the distinct figures, cheapest first. `reporters` counts the
 * DROPS behind them rather than accounts, because an anonymous drop carries no
 * authority key and this reading is about what is on the page, not about who
 * may paint a pin.
 */
export type PintPriceSplit = {
  prices: number[];
  reporters: number;
};

/** The minimum a row needs before its REPORTER can be counted. */
export type ReportedDrop = AgreeableDrop & { authorityKey?: string };

/**
 * How many drinkers are behind these drops.
 *
 * Distinct authority keys, plus ONE for every drop that carries none. A key is
 * the only proof this tree has that two reports came from two people, and an
 * unattributed drop carries none by construction (lib/pintDropConfirmation.ts),
 * so it is counted as its own report: the pub's own sheet already prints it as
 * a separate row, and folding every keyless drop into one would tell a reader
 * a pub holds fewer reports than it shows them.
 */
function reporterCount(drops: readonly ReportedDrop[]): number {
  const keys = new Set<string>();
  let keyless = 0;
  for (const drop of drops) {
    const key = drop.authorityKey?.trim();
    if (key) keys.add(key);
    else keyless += 1;
  }
  return keys.size + keyless;
}

/**
 * The split among drops that are already about ONE drink and measure, or null
 * when they all report one figure.
 *
 * Callers pass a single drink group. Grouping is the caller's job, because the
 * caller is the one that knows which group the pub's price area is about.
 */
export function pintPriceSplitOf(drops: readonly ReportedDrop[]): PintPriceSplit | null {
  const pennies = new Set<number>();
  const counted: ReportedDrop[] = [];
  for (const drop of drops) {
    if (typeof drop.priceGbp !== "number" || !Number.isFinite(drop.priceGbp)) continue;
    if (!measureIsPint(drop.measure)) continue;
    pennies.add(pricePennies(drop.priceGbp));
    counted.push(drop);
  }
  if (pennies.size < 2) return null;
  const reporters = reporterCount(counted);
  const prices = Array.from(pennies)
    .sort((a, b) => a - b)
    .map((value) => value / 100);
  return { prices, reporters };
}

/**
 * The count words this product says out loud. Two and three are the counts a
 * split reaches in practice; past that the numeral is plainer than the word,
 * and "seventeen drinkers" would read as a boast rather than a fact.
 */
const COUNT_WORDS = ["", "One", "Two", "Three", "Four", "Five"] as const;

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** "£4.50 and £4.70", or "£4.50, £4.70 and £5.00". */
export function joinPriceFigures(prices: readonly number[]): string {
  const figures = prices.map((price) => formatGbp(price));
  if (figures.length <= 1) return figures[0] ?? "";
  return `${figures.slice(0, -1).join(", ")} and ${figures[figures.length - 1]}`;
}

/**
 * THE ONE LINE a split prints, wherever it prints: the Overview's price area,
 * the phone peek chip and the second drinker's door all say this.
 *
 * "Two drinkers, two prices: £4.50 and £4.70". Both counts are said because
 * they come apart: three drops holding two figures is three drinkers and two
 * prices, and printing one count for both would tell the reader something
 * nobody reported.
 */
export function pintPriceSplitLine(split: PintPriceSplit): string {
  const drinkers = `${countWord(split.reporters)} drinker${split.reporters === 1 ? "" : "s"}`;
  const prices = `${countWord(split.prices.length).toLowerCase()} prices`;
  return `${drinkers}, ${prices}: ${joinPriceFigures(split.prices)}`;
}

/** The range a compact chip prints when it has room for one string: "£4.50-£4.70". */
export function pintPriceSplitRange(split: PintPriceSplit): string {
  const first = split.prices[0];
  const last = split.prices.at(-1);
  if (first === undefined || last === undefined) return "";
  return `${formatGbp(first)}-${formatGbp(last)}`;
}
