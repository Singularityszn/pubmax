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
import {
  cleanDrinkMeasureLabel,
  drinkMeasureName,
  measureIsPint,
  statedDrinkMeasure,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";

/**
 * The drink texts that NAME NO DRINK. The one-tap composer offers a closed
 * category and no free text, so it writes the lane's own label ("Beer") as the
 * drop's drink (`writeOneTapPintDrop`, lib/oneTapPintDrop.server.ts), while the
 * full Pint Drop composer writes whatever the drinker typed ("Guinness").
 *
 * A category label is not a named product for a split. Existing confirmation
 * compatibility remains unchanged; the stricter named-claim reader below owns
 * whether the UI may offer a choice between conflicting prices.
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
 * A named product and serving that can be compared honestly.
 *
 * A missing product or measure is a REAL report, but it is not a claim we can
 * join to another row. In particular, the pre-0147 absence of `measure` keeps
 * its historic pint-lane reach through `measureIsPint`, but must not silently
 * make a legacy row agree with a drinker who explicitly chose Pint today.
 * Likewise the one-tap category label "Beer" names no product. Unknowns stay
 * visible one at a time; they never become a named split.
 */
export type NamedPintClaim = {
  drink: string;
  measure: DrinkMeasure;
  measureLabel: string;
};

function normalisedDrinkLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function measureAgreementKey(claim: Pick<AgreeableDrop, "measure" | "measureLabel">): string {
  const measure = claim.measure ?? "pint";
  return `${measure}|${measure === "other" ? (claim.measureLabel?.trim().toLowerCase() ?? "") : ""}`;
}

/** The exact named claim this row can make, or null where either part is unknown. */
export function namedPintClaim(drop: AgreeableDrop): NamedPintClaim | null {
  const productKey = drinkAgreementKey(drop);
  if (!productKey) return null;
  const measure = statedDrinkMeasure(drop.measure);
  if (!measure) return null;
  const measureLabel = measure === "other" ? cleanDrinkMeasureLabel(drop.measureLabel) : "";
  if (measure === "other" && !measureLabel) return null;
  return {
    drink: normalisedDrinkLabel(drop.drink),
    measure,
    measureLabel,
  };
}

/** Existing confirmation compatibility; split choices require namedPintClaim. */
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
export type PintPriceSplit = NamedPintClaim & {
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
 * The split among drops that are all about ONE named product and ONE stated
 * measure, or null when they all report one figure.
 *
 * This verifies that promise even when a caller has already grouped rows: an
 * unknown or differently named claim refuses the whole proposed group rather
 * than being quietly folded into it.
 */
export function pintPriceSplitOf(drops: readonly ReportedDrop[]): PintPriceSplit | null {
  const counted: Array<{ drop: ReportedDrop; claim: NamedPintClaim }> = [];
  for (const drop of drops) {
    if (typeof drop.priceGbp !== "number" || !Number.isFinite(drop.priceGbp)) continue;
    if (!measureIsPint(drop.measure)) continue;
    const claim = namedPintClaim(drop);
    if (!claim) return null;
    counted.push({ drop, claim });
  }
  const first = counted[0]?.claim;
  if (!first) return null;
  const product = drinkAgreementKey({ ...first, priceGbp: null });
  if (
    !counted.every(
      ({ claim }) =>
        drinkAgreementKey({ ...claim, priceGbp: null }) === product &&
        measureAgreementKey(claim) === measureAgreementKey(first),
    )
  ) {
    return null;
  }
  const pennies = new Set(counted.map(({ drop }) => pricePennies(drop.priceGbp as number)));
  if (pennies.size < 2) return null;
  const reporters = reporterCount(counted.map(({ drop }) => drop));
  const prices = Array.from(pennies)
    .sort((a, b) => a - b)
    .map((value) => value / 100);
  return { ...first, prices, reporters };
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
 * THE ONE line the split itself prints. Its named claim is rendered separately
 * through `pintPriceSplitClaimLabel`, so the reader knows exactly which product
 * and serving the figures describe.
 *
 * "Two drinkers, two prices: £4.50 and £4.70". Both counts are said because
 * they come apart: three drops holding two figures is three drinkers and two
 * prices, and printing one count for both would tell the reader something
 * nobody reported.
 */
export function pintPriceSplitLine(split: Pick<PintPriceSplit, "prices" | "reporters">): string {
  const drinkers = `${countWord(split.reporters)} drinker${split.reporters === 1 ? "" : "s"}`;
  const prices = `${countWord(split.prices.length).toLowerCase()} prices`;
  return `${drinkers}, ${prices}: ${joinPriceFigures(split.prices)}`;
}

/** The named claim beside a split: "Lager pint", never a generic Beer label. */
export function pintPriceSplitClaimLabel(split: PintPriceSplit): string {
  return `${split.drink} ${drinkMeasureName(split.measure, split.measureLabel).toLowerCase()}`;
}

/** The range a compact chip prints when it has room for one string: "£4.50-£4.70". */
export function pintPriceSplitRange(split: PintPriceSplit): string {
  const first = split.prices[0];
  const last = split.prices[split.prices.length - 1];
  return `${formatGbp(first)}-${formatGbp(last)}`;
}
