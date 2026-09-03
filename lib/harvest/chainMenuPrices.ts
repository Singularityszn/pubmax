// What a chain menu page is allowed to yield, and how a price gets off it.
//
// PURE ON PURPOSE. The CLI in scripts/harvest_chain_menu_prices.mjs does the
// fetching; everything that decides what counts as a price lives here, where it
// can be tested without a network. That split is the same one the events lane
// uses (lib/whatson/eventNormalise.mjs beside its CLI) and for the same reason:
// a rule only a script knows is a rule nobody can check.
//
// THE ABSOLUTE RULE, inherited from scripts/harvest_outer_london_prices.mjs: a
// price is kept only if the exact figure appears LITERALLY in the page text we
// read. An extractor that returns £5.40 for a page that never says £5.40 has
// hallucinated, and a hallucinated price is worse than no price at all.
//
// PERMISSION AND SUPPLY ARE TWO QUESTIONS, and this module answers only the
// second. Whether a host may be read at all is lib/harvest/sourcePolicy.ts and
// lib/harvest/robots.ts, asked live, before anything here runs.

/** Why a candidate figure on a permitted page did not become a row. */
export const CHAIN_PRICE_DROP_REASONS = [
  "not-verbatim-on-page",
  "outside-pint-band",
  "no-drink-word-nearby",
  "food-word-nearby",
  "no-price-on-page",
] as const;
export type ChainPriceDropReason = (typeof CHAIN_PRICE_DROP_REASONS)[number];

/**
 * A pint's plausible band in the UK. Outside it the figure is a bottle, a
 * carafe, a food line or a tab total, and it is dropped rather than squeezed in.
 */
export const CHAIN_PINT_MIN_GBP = 2;
export const CHAIN_PINT_MAX_GBP = 12;

/** How much page text either side of a figure is read for its drink word. */
export const PRICE_CONTEXT_CHARS = 80;

/** A draught pint's own vocabulary. A figure with none of this beside it is not a pint. */
const DRINK_WORDS =
  /\b(pint|draught|draft|on tap|lager|real ale|ale|cider|stout|guinness|ipa|pale ale|bitter|porter|session|neck oil|madri|camden|amstel|carling|fosters|foster's|peroni|heineken|cruzcampo|kronenbourg|beavertown|estrella|moretti|birra|san miguel|stella|carlsberg|thatchers|aspall|inches)\b/i;

/**
 * Words that mean the figure belongs to a plate rather than a glass. Checked
 * AFTER the drink word, because "steak and a pint for £16.99" is a meal deal
 * and not the price of the pint.
 */
const FOOD_WORDS =
  /\b(burger|steak|pizza|meal|deal|roast|breakfast|brunch|lunch|sandwich|wrap|curry|fish and chips|dessert|sundae|platter|sharer|combo|bundle|two courses|three courses|with a)\b/i;

const PRICE_PATTERN = /£\s?(\d{1,2}(?:\.\d{2})?)\b/g;

export type ChainPriceCandidate = {
  priceGbp: number;
  /** The exact substring the page carried, kept for the verbatim check. */
  verbatim: string;
  /** The text either side, which is what the drink and food words are read from. */
  context: string;
};

export type ChainPriceReading = {
  kept: ChainPriceCandidate[];
  drops: ChainPriceDropReason[];
};

/**
 * Strip a page to the text a reader sees. Scripts and styles go first, because
 * a price inside a JSON blob or a CSS rule is not something the page states.
 */
export function pageText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every pint price a page STATES, with each rejection counted.
 *
 * A page with no figure at all answers one `no-price-on-page` drop rather than
 * an empty result, because "we read it and it says nothing" is a finding and an
 * empty list is not.
 */
export function readChainPintPrices(html: string): ChainPriceReading {
  const text = pageText(html);
  const kept: ChainPriceCandidate[] = [];
  const drops: ChainPriceDropReason[] = [];

  const matches = [...text.matchAll(PRICE_PATTERN)];
  if (matches.length === 0) return { kept, drops: ["no-price-on-page"] };

  for (const match of matches) {
    const priceGbp = Number(match[1]);
    const verbatim = match[0];
    const at = match.index ?? 0;
    const context = text.slice(
      Math.max(0, at - PRICE_CONTEXT_CHARS),
      at + verbatim.length + PRICE_CONTEXT_CHARS,
    );

    // The verbatim rule, applied to our own extraction as well: the figure we
    // are about to keep has to be readable in the page we read.
    if (!text.includes(verbatim)) {
      drops.push("not-verbatim-on-page");
      continue;
    }
    if (!Number.isFinite(priceGbp) || priceGbp < CHAIN_PINT_MIN_GBP || priceGbp > CHAIN_PINT_MAX_GBP) {
      drops.push("outside-pint-band");
      continue;
    }
    if (!DRINK_WORDS.test(context)) {
      drops.push("no-drink-word-nearby");
      continue;
    }
    if (FOOD_WORDS.test(context)) {
      drops.push("food-word-nearby");
      continue;
    }
    kept.push({ priceGbp, verbatim, context });
  }

  return { kept, drops };
}

/**
 * The cheapest pint a page states, which is the figure a pub's own row carries.
 * Null when the page states none.
 */
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
