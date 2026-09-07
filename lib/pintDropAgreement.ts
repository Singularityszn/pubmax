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

import { measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";

/** The minimum a row needs before this module can compare it with another. */
export type AgreeableDrop = {
  drink: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  priceGbp: number | null;
};

/** A price as whole pennies, so 4.5 and 4.50 are one figure and 4.5 and 4.7 are two. */
export function pricePennies(priceGbp: number): number {
  return Math.round(priceGbp * 100);
}

/**
 * The drink two drops have to share before their prices are about one thing.
 *
 * `drink` is free text a drinker types, so it is compared case-insensitively
 * with its whitespace collapsed and nothing else: "Guinness" and "guinness"
 * are one drink, and "Guinness" and "Guinness 0.0" are two, which is the
 * honest answer when we cannot ask.
 *
 * The measure rides in the key because a half is a different serving and the
 * pint lanes already hold it out; an `other` measure carries its own label, so
 * a schooner and a bottle never merge into one "other".
 */
export function drinkAgreementKey(drop: AgreeableDrop): string {
  const drink = drop.drink.trim().toLowerCase().replace(/\s+/g, " ");
  const measure: DrinkMeasure = drop.measure ?? "pint";
  const label = measure === "other" ? (drop.measureLabel?.trim().toLowerCase() ?? "") : "";
  return `${drink}|${measure}|${label}`;
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
  return drinkAgreementKey(a) === drinkAgreementKey(b);
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

/**
 * The split among drops that are already about ONE drink and measure, or null
 * when they all report one figure.
 *
 * Callers pass a single drink group. Grouping is the caller's job, because the
 * caller is the one that knows which group the pub's price area is about.
 */
export function pintPriceSplitOf(drops: readonly AgreeableDrop[]): PintPriceSplit | null {
  const pennies = new Set<number>();
  let reporters = 0;
  for (const drop of drops) {
    if (typeof drop.priceGbp !== "number" || !Number.isFinite(drop.priceGbp)) continue;
    if (!measureIsPint(drop.measure)) continue;
    pennies.add(pricePennies(drop.priceGbp));
    reporters += 1;
  }
  if (pennies.size < 2) return null;
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
  const last = split.prices[split.prices.length - 1];
  return `${formatGbp(first)}-${formatGbp(last)}`;
}
