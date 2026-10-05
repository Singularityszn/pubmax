// What a chain menu page is allowed to yield, and how a price gets off it.
//
// PURE ON PURPOSE. The CLI in scripts/harvest_chain_menu_prices.mjs does the
// fetching; everything that decides what counts as a price lives in
// lib/harvest/ukPriceCrawl.ts, the one reader. This file keeps the chain
// lane's own shape: pint-only kept rows and this lane's drop-reason names.
//
// THE ABSOLUTE RULE, inherited from scripts/harvest_outer_london_prices.mjs: a
// price is kept only if the exact figure appears LITERALLY in the page text we
// read. An extractor that returns £5.40 for a page that never says £5.40 has
// hallucinated, and a hallucinated price is worse than no price at all.
//
// PERMISSION AND SUPPLY ARE TWO QUESTIONS, and this module answers only the
// second. Whether a host may be read at all is lib/harvest/sourcePolicy.ts and
// lib/harvest/robots.ts, asked live, before anything here runs.

import {
  CATEGORY_PRICE_BANDS,
  pageText as harvestPageText,
  drinkLabelFromPriceContext,
  readVenueDrinkPrices,
  type UkPriceDropReason,
  type UkPriceReading,
} from "./ukPriceCrawl";

/** Why a candidate figure on a permitted page did not become a row. */
export const CHAIN_PRICE_DROP_REASONS = [
  "not-verbatim-on-page",
  "outside-pint-band",
  "no-drink-word-nearby",
  "food-word-nearby",
  "no-price-on-page",
] as const;
type ChainPriceDropReason = (typeof CHAIN_PRICE_DROP_REASONS)[number];

/**
 * A pint's plausible band in the UK. The shared beer band, restated under the
 * names this lane already publishes.
 */
export const CHAIN_PINT_MIN_GBP = CATEGORY_PRICE_BANDS.beer?.minGbp ?? 2;
export const CHAIN_PINT_MAX_GBP = CATEGORY_PRICE_BANDS.beer?.maxGbp ?? 12;

type ChainPriceCandidate = {
  priceGbp: number;
  /** The exact substring the page carried, kept for the verbatim check. */
  verbatim: string;
  /** The text either side, which is what the drink and food words are read from. */
  context: string;
  drinkLabel?: string;
};

export type ChainPriceReading = {
  kept: ChainPriceCandidate[];
  drops: ChainPriceDropReason[];
};

/** Strip a page to the text a reader sees. Owned by the shared reader. */
export const pageText = harvestPageText;

function chainDropFromUk(reason: UkPriceDropReason): ChainPriceDropReason {
  switch (reason) {
    case "not-verbatim-on-page":
      return "not-verbatim-on-page";
    case "outside-category-band":
      return "outside-pint-band";
    case "food-word-nearby":
      return "food-word-nearby";
    case "no-price-on-page":
      return "no-price-on-page";
    default:
      return "no-drink-word-nearby";
  }
}

/**
 * Map a shared drinks reading onto this lane's pint-only shape, keeping this
 * lane's drop-reason names.
 */
export function chainPintReadingFromUk(reading: UkPriceReading): ChainPriceReading {
  const kept: ChainPriceCandidate[] = [];
  const drops: ChainPriceDropReason[] = [];
  for (const row of reading.kept) {
    if (row.category === "beer") {
      const drinkLabel =
        row.drinkLabel ?? drinkLabelFromPriceContext(row.context, row.verbatim) ?? undefined;
      kept.push({ priceGbp: row.priceGbp, verbatim: row.verbatim, context: row.context, drinkLabel });
    } else {
      drops.push("no-drink-word-nearby");
    }
  }
  for (const reason of reading.drops) drops.push(chainDropFromUk(reason));
  return { kept, drops };
}

/**
 * Every pint price a page STATES, with each rejection counted.
 *
 * A page with no figure at all answers one `no-price-on-page` drop rather than
 * an empty result, because "we read it and it says nothing" is a finding and an
 * empty list is not.
 */
export function readChainPintPrices(html: string): ChainPriceReading {
  return chainPintReadingFromUk(readVenueDrinkPrices(html, "html"));
}

/**
 * The cheapest pint a page states, which is the figure a pub's own row carries.
 * Null when the page states none.
 */

/**
 * The cheapest stated pint and its printed menu name, when the page named it.
 */
export function cheapestStatedPintRow(
  reading: ChainPriceReading,
): { priceGbp: number; drinkLabel?: string } | null {
  let best = reading.kept[0];
  if (!best) return null;
  for (const row of reading.kept) {
    if (row.priceGbp < best.priceGbp) best = row;
  }
  return { priceGbp: best.priceGbp, drinkLabel: best.drinkLabel };
}

export function cheapestStatedPint(reading: ChainPriceReading): number | null {
  if (reading.kept.length === 0) return null;
  return reading.kept.reduce((low, row) => (row.priceGbp < low ? row.priceGbp : low), Infinity);
}

export type ChainCoverageRow = {
  city: string;
  pagesRead: number;
  venuesPriced: number;
  /** Pages that were read and stated no pint price. */
  pagesWithNoPrice: number;
};

/**
 * The coverage line per city. It prints the zero cases too: a city with no
 * priced venue is the finding this whole run exists to produce, and rounding it
 * away would turn a measured gap into a silence.
 */
export function coverageLine(row: ChainCoverageRow): string {
  if (row.pagesRead === 0) return `${row.city}: no permitted page to read`;
  const noun = row.venuesPriced === 1 ? "venue" : "venues";
  return `${row.city}: ${row.venuesPriced} ${noun} priced from ${row.pagesRead} page(s) read, ${row.pagesWithNoPrice} stating no price`;
}
