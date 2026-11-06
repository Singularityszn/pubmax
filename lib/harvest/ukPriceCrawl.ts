// What a pub's OWN website is allowed to yield, and how a drink price gets off
// it.
//
// PURE ON PURPOSE, exactly as lib/harvest/chainMenuPrices.ts is pure: the CLI
// in scripts/harvest/uk-prices/run.mjs does the fetching, and everything that
// decides what counts as a price lives here where it can be tested without a
// network. parse5 supplies HTML structure without fetching the page.
//
// THIS IS THE ONE PRICE READER. The chain menu lane and the Tavily enrichment
// lane map onto it. Widened in two places and narrowed in one versus the old
// chain-only table.
//
//   Widened first by DRINK: a chain page was read for a pint alone, because a
//   pint is what the chain lane was built to price. A pub's own drinks list
//   states a wine, a gin and a soft drink beside the ale, and dropping those
//   would throw away evidence a reader asked for. Every kept row therefore
//   names its own `lib/drinks.ts` category, and the band it is checked against
//   is that category's own, because £14 is a fair cocktail and an impossible
//   pint.
//
//   Widened second by PAGE: a chain source names the one page it publishes. A
//   pub site does not, so this module also decides which of a page's own links
//   look like a drinks list, and the crawler follows only those.
//
//   Narrowed by the thing that matters: the verbatim rule is unchanged and
//   absolute. A figure is kept only when it appears LITERALLY in the text of
//   the page that was read, with attributable drink context and no food word. An
//   extractor that returns a price the page never stated has invented it, and
//   an invented price is worse than no price at all.
//
// PERMISSION IS SOMEBODY ELSE'S QUESTION. Whether a host may be read at all is
// lib/harvest/sourcePolicy.ts and lib/harvest/robots.ts, asked live, before
// anything here runs.

import {
  COFFEE_HARVEST_WORD_PATTERN,
  canonicalCoffeePilotDrink,
  coffeePriceLabelExcluded,
} from "@/lib/coffeePricePilot";
import type { DrinkCategory } from "@/lib/drinks";
import { parse, parseFragment, serializeOuter, type DefaultTreeAdapterTypes } from "parse5";

/** Why a candidate figure on a permitted page did not become a row. */
export const UK_PRICE_DROP_REASONS = [
  "not-verbatim-on-page",
  "outside-category-band",
  "no-drink-word-nearby",
  "food-word-nearby",
  "no-price-on-page",
  // The page states a figure with a drink word beside it that names no category
  // we publish. Counted rather than filed under `other`, because `other` names
  // no drink and a row nobody can label is a row nobody can read.
  "no-category-word-nearby",
  // The figure is the HALF, and a half is not a pint. A draught list states
  // "Peroni Half £3.55 £7.10", and taking the cheapest figure on the line puts
  // a half-pint price on a pub's card as the price of a pint.
  "half-measure-not-a-pint",
  "fractional-measure-not-a-pint",
  // The figure is a BOTTLE or a CAN, and a bottled beer beside a draught list
  // is a different drink at a different price. Publishing the cheaper of the
  // two as the pub's beer price undercuts the pint nobody can buy at it.
  "bottled-measure-not-a-pint",
  // The figure prices a SPIRIT AND MIXER, and the taxonomy names no such drink.
  // "Dead Man's Fingers Coffee With Pepsi Max £7.00" is one figure over two
  // drinks, and every reading of it is wrong: the nearest word files it as a
  // £7 Pepsi, demoting the mixer files it as a £7 coffee, and it is neither.
  // "Bosford Rose, try with Britvic Bitter Lemon £7.25" is the same shape and
  // filed as a £7.25 PINT, on `bitter`. A figure nobody can label honestly is
  // dropped and counted.
  "mixer-serve-not-one-drink",
  // An unpriced line between the last figure and this one names a cocktail or
  // a zero-strength drink, and this figure's own line does not. That line is
  // either this item's printed name ("Lucky Saint 0%" above "Unfiltered lager
  // £5.20") or the last item's description or a heading above a beer, and the
  // page does not say which. Guessing either way files a wrong price.
  "item-name-ambiguous",
  // The figure is an OFFER, not a price. "2 for £9", "meals for only £5.99" and
  // "wines from £5.50" are all marketing copy that states a number a drinker
  // cannot walk in and pay for one named drink. The first run of this crawler
  // put a Brewers Fayre happy-hour "2 for £9" onto 27 pubs as the price of a
  // pint, which is the whole reason this reason exists.
  "offer-not-a-menu-price",
  // The page states a price or two beside a drink word and is not a drinks
  // list: a homepage promo shelf, a blog post, an events page. A real list
  // states many.
  "page-is-not-a-drinks-list",
  // A host serving many pubs stated a price on a page that names none of them.
  // An estate-wide figure is not this pub's price, and attributing it to every
  // pub on the host is how one number becomes hundreds of wrong ones.
  "page-names-no-pub",
  // TypeSafe judged the figure below the publish threshold and above no action.
  "judgment-needs-review",
  // TypeSafe judged the figure too uncertain to publish or route to review.
  "judgment-below-threshold",
  // TypeSafe could not judge this batch: spend ceiling, call failure, or bad shape.
  "typesafe-judgment-budget-refused",
  "typesafe-judgment-call-timeout",
  "typesafe-judgment-call-error",
  "typesafe-judgment-malformed-answer",
] as const;
export type UkPriceDropReason = (typeof UK_PRICE_DROP_REASONS)[number];

/**
 * The plausible band per drink, in pounds. A figure outside its own category's
 * band is a bottle, a carafe, a tab total or a plate, and it is dropped rather
 * than squeezed in.
 *
 * The pint band (2 to 12) is the chain lane's own, restated here for the one
 * category it covered. The rest are set at the same bar: wide enough that a
 * genuinely dear London pour survives, narrow enough that a food line does not.
 * Categories absent from this table are not extracted at all, which is why
 * `other` has no row: it names no drink, so no band could be honest about it.
 */
export const CATEGORY_PRICE_BANDS: Readonly<
  Partial<Record<DrinkCategory, { minGbp: number; maxGbp: number }>>
> = {
  beer: { minGbp: 2, maxGbp: 12 },
  wine: { minGbp: 3, maxGbp: 18 },
  cocktail: { minGbp: 5, maxGbp: 22 },
  whisky: { minGbp: 2.5, maxGbp: 25 },
  gin: { minGbp: 2.5, maxGbp: 18 },
  vodka: { minGbp: 2.5, maxGbp: 18 },
  rum: { minGbp: 2.5, maxGbp: 18 },
  shot: { minGbp: 1.5, maxGbp: 12 },
  "alcohol-free": { minGbp: 1, maxGbp: 9 },
  "soft-drink": { minGbp: 0.8, maxGbp: 7 },
  coffee: { minGbp: 1, maxGbp: 7 },
};

/** How much page text either side of a figure is read for its drink word. */
const PRICE_CONTEXT_CHARS = 80;

const ZERO_ALCOHOL_MARKER = /(?<![\w.,])0(?:\.0+)?\s*%(?![\d.])/i;

const SOFT_DRINK_WEARING_A_BEER_WORD = /\b(ginger\s+(ale|beer)|bitter\s+lemon|root\s+beer|dandelion\s*(and|&)\s*burdock)\b/i;

/**
 * The vocabulary that names a category, strongest signal first. The order is
 * the order these are TESTED in, so a phrase that belongs to two lanes lands in
 * the narrower one: "alcohol-free lager" is alcohol-free before it is beer, and
 * "espresso martini" is a cocktail before it is a coffee.
 */
const CATEGORY_WORDS: ReadonlyArray<{ category: DrinkCategory; pattern: RegExp }> = [
  { category: "alcohol-free", pattern: ZERO_ALCOHOL_MARKER },
  {
    category: "alcohol-free",
    pattern:
      /\b(non[- ]alcoholic\s+ginger\s+beer|alcohol[- ]free|non[- ]alcoholic|no[- ]and[- ]low|lucky saint|erdinger alkoholfrei|(?:guinness|heineken) 0(?![.\d])|becks blue)\b/i,
  },
  {
    // Crabbie's is explicitly sold as alcoholic ginger beer. The generic
    // ``ginger beer`` exception below must not erase that stronger label.
    category: "beer",
    pattern: /(?<!non[- ])\balcoholic\s+ginger\s+beer\b/i,
  },
  {
    category: "cocktail",
    pattern:
      /\b(cocktail|martini|negroni|margarita|mojito|daiquiri|old fashioned|aperol spritz|spritz|bloody mary|cosmopolitan|pornstar|espresso martini|highball|mai tai|paloma|long island(?: iced tea)?|clover club|caipirinha|(?:whisky|whiskey|amaretto|pisco|gin|vodka) sour)\b/i,
  },
  {
    // A SOFT DRINK WEARING A BEER WORD. "Ginger ale" and "ginger beer" sit on
    // every pub's soft-drink list, and reading the second word alone filed them
    // as beer at £2.55, which then became the pub's cheapest pint. "Bitter
    // lemon" is the same trick on `bitter`, and it put £7.25 on a pub's card as
    // the price of a pint. These sit AHEAD of beer so the tie goes the narrow way.
    category: "soft-drink",
    pattern: SOFT_DRINK_WEARING_A_BEER_WORD,
  },
  {
    category: "beer",
    pattern:
      /\b(beer|pilsner|pils|draught|draft|on tap|cask|keg|lager|real ale|ale|cider|stout|guinness|ipa|neipa|pale ale|bitter|porter|session|neck oil|madri|camden|amstel|carling|fosters|foster's|peroni|heineken|cruzcampo|kronenbourg|beavertown|estrella|moretti|birra|san miguel|stella|carlsberg|thatchers|aspall|inches|doom bar|landlord|hophead)\b/i,
  },
  {
    category: "wine",
    pattern:
      /\b(wine|red wine|white wine|ros[eé]|prosecco|champagne|sauvignon|chardonnay|merlot|malbec|pinot|shiraz|rioja|tempranillo|175ml|glass of wine)\b/i,
  },
  { category: "whisky", pattern: /\b(whisky|whiskey|bourbon|scotch|single malt|rye)\b/i },
  { category: "gin", pattern: /\b(gin|gordon's|bombay|tanqueray|hendrick's|beefeater gin)\b/i },
  { category: "vodka", pattern: /\b(vodka|smirnoff|absolut|grey goose)\b/i },
  { category: "rum", pattern: /\b(rum|bacardi|captain morgan|kraken|havana club)\b/i },
  { category: "shot", pattern: /\b(shot|shots|tequila|sambuca|jagerbomb|j[aä]germeister)\b/i },
  {
    category: "soft-drink",
    pattern:
      /\b(soft drink|coke|coca[- ]cola|pepsi|lemonade|j2o|fruit shoot|juice|squash|still water|sparkling water|bottled water|spring water)\b/i,
  },
  { category: "coffee", pattern: COFFEE_HARVEST_WORD_PATTERN },
];

/**
 * Words that mean the figure belongs to a plate rather than a glass. Checked
 * AFTER the category word, because "steak and a pint for £16.99" is a meal deal
 * and not the price of the pint. This is the chain lane's own list, which is
 * why it reads the same: one rule, two callers.
 */
const FOOD_WORDS =
  /\b(burger|steak|pizza|meal|roast|breakfast|brunch|lunch|dinner|supper|sandwich|wrap|curry|fish and chips|dessert|sundae|platter|sharer|combo|bundle|two courses|three courses|with a|per person|deposit|room rate|per night|bed and breakfast|starter|main course|mains|side|sides|salad|bread|butter|batter|fishcake|soup|mayonnaise|squid|calamari|scampi|prawn|crab|lobster|oyster|chicken|beef|pork|lamb|duck|sausage|chips|fries|parfait|p[aâ]t[eé]|terrine|risotto|pasta|gnocchi|pie\b|cheese|ploughman|sunday|nachos|wings|halloumi|garnish|served with|vegan|vegetarian|gluten)\b/i;

/**
 * A food dish that borrows a drink's word. "Crab cocktail" and "prawn cocktail"
 * are the two that turn a starter into a cocktail price on a pub's card, and
 * they appear on more food menus than any actual cocktail list.
 */
const FOOD_WEARING_A_DRINK_WORD = /\b(crab|prawn|shrimp|seafood|fruit)\s+cocktail\b/i;

/**
 * Words that mean the figure is an OFFER rather than the price of one drink.
 * Checked before anything else a figure could be, because an offer that names a
 * drink passes every other test this module applies.
 *
 * `from` and `only` are in here deliberately. "Wines from £5.50" states the
 * floor of a range and names no drink at that price, and "only £5.99" is a
 * promotion. Both would read on a pub's card as a price a drinker could pay.
 */
const OFFER_WORDS =
  /(\b\d+\s+for\b|\btwo for\b|\bhappy hour\b|\boffer|\bsave\b|\bwas\b|\bonly\b|\bfrom\b|\bdeal\b|\bpromo|\bdiscount|(?<!\balcohol[- ])\bfree\b|\bbottomless\b|\bunlimited\b|\bper person\b|\bvoucher|\bgift\b|\bwhen you\b|\bterms\b)/i;

function* groupOfferMatches(text: string): Iterable<RegExpMatchArray> {
  for (const match of text.matchAll(new RegExp(OFFER_WORDS.source, "gi"))) {
    const cue = match[0].toLowerCase();
    const at = match.index ?? 0;
    // A bound modifier such as a dietary compound is not the offer word on its own.
    if (cue === "free" && /(?<![\p{L}\p{N}-])\p{L}+-$/u.test(text.slice(0, at))) continue;
    // These words modify an amount or a time, rather than an unrelated phrase.
    if ((cue === "from" || cue === "was") && !/^\s*(?:\d|$)/.test(text.slice(at + cue.length))) continue;
    yield match;
  }
}

/**
 * How many priced drink lines a page has to state before it counts as a drinks
 * LIST. A menu states many; a homepage promo shelf states one or two. Four is
 * the floor because three is the smallest number that could still be a banner
 * carrying a headline, a sub-line and a footnote.
 */
export const MIN_PRICED_LINES_FOR_LIST = 4;

/**
 * Whether a figure is the HALF price on a draught line.
 *
 * A draught list states the measure once and then both figures:
 * "Peroni Half £3.55 £7.10". The half is the first figure after the word, so a
 * figure with `half` behind it and no other figure in between is the half
 * price. Cheapest-wins would otherwise put £3.55 on the pub's card as the price
 * of a pint, which is a real price for a drink nobody asked about.
 */
/**
 * Whether a beer figure is a BOTTLE or a CAN rather than a draught pour.
 *
 * A drinks list states its bottled beers beside its draught ones, and a 330ml
 * Corona at £3.85 is cheaper than every pint on the same page. Cheapest-wins
 * would publish it as the pub's beer price, which is a real figure for a drink
 * that is not the one the price is being read as.
 */
function isBottledMeasure(before: string): boolean {
  // 568ml is a UK pint, not a bottle. The generic ml pattern would otherwise
  // drop every drinks list that writes the measure in millilitres.
  if (/\b568\s*ml\b/i.test(before)) return false;
  return /(\d{2,3}\s?ml|\bbottle[ds]?\b|\bcans?\b)/i.test(before);
}

/**
 * A draught line that states its pair as `£2.30/£4.60` names no measure at all,
 * and the first figure is still the half. Reading the pair left to right is the
 * only thing that separates them, and cheapest-wins would take the half every
 * time.
 */
function isFirstOfAMeasurePair(after: string): boolean {
  return /^\s*[|/]\s*£/.test(after);
}

/**
 * A draught table that heads its columns "Half" and "Pint" once prints each line
 * as a bare pair: "Carling 4.0% £3.60 £7.20". No measure word sits beside either
 * figure, so the pair is read by its shape: a figure followed at once by a second
 * figure about twice its size is the half.
 */
function isHalfOfABarePair(after: string, priceGbp: number): boolean {
  const next = /^\s*£\s?(\d{1,2}(?:\.\d{1,2})?)(?!\d)/.exec(after);
  if (!next) return false;
  const ratio = Number(next[1]) / priceGbp;
  return ratio >= 1.7 && ratio <= 2.3;
}

function isHalfMeasure(before: string): boolean {
  // "½ pint" or "1/2 Pint" right before the figure is the half on its own,
  // with or without the word half anywhere on the line.
  if (/[½]|\b1\/2\b/.test(before.slice(-14))) return true;
  const at = before.toLowerCase().lastIndexOf("half");
  if (at < 0) return false;
  return !before.slice(at + 4).includes("£");
}

export const UK_PRICE_PATTERN = /£\s?(\d{1,2}(?:\.\d{1,2})?)(?![\da-z]|\.\d)/gi;

// Item punctuation is a boundary after a known price or measure. Commas inside
// a drink name remain part of that name. Hyphens need padding to avoid splitting names.
export const PRICE_ITEM_SEPARATOR = /(?:[,.;:•·|!?]|\s+-\s+)/;
const LEADING_PRICE_ITEM_SEPARATORS = new RegExp(`^\\s*(?:${PRICE_ITEM_SEPARATOR.source}\\s*)+`);

export const FRACTIONAL_BEER_MEASURE = /(?:\b[12][ \t]*\/[ \t]*3(?=\b|pints?\b)|[⅓⅔]|\b(?:one[ \t-]third|two[ \t-]thirds)\b)/i;

export function fractionalBeerServing(text: string): "one-third" | "two-thirds" | null {
  const match = FRACTIONAL_BEER_MEASURE.exec(text)?.[0];
  if (!match) return null;
  return /^(?:1|⅓|one)/i.test(match) ? "one-third" : "two-thirds";
}

const FRACTIONAL_PINT_UNIT = "[ \\t-]*(?:of\\s+a\\s+)?pints?\\b";
export const FRACTIONAL_PINT_MEASURE = new RegExp(
  `(?:${FRACTIONAL_BEER_MEASURE.source})${FRACTIONAL_PINT_UNIT}`, "i",
);
export const MIXED_THIRD_PINT_MEASURE = new RegExp(
  `(?<![\\w.])\\d{1,2}(?:(?:[ \\t-]+|[ \\t]+and[ \\t]+)(?:${FRACTIONAL_BEER_MEASURE.source})|[ \\t]*[⅓⅔])${FRACTIONAL_PINT_UNIT}`, "i",
);
const FRACTIONAL_SERVING = `(?:${MIXED_THIRD_PINT_MEASURE.source}|(?:${FRACTIONAL_BEER_MEASURE.source})(?:${FRACTIONAL_PINT_UNIT})?)`;
const LEADING_FRACTIONAL_BEER_MEASURE = new RegExp(
  `^\\s*(?:\\(\\s*${FRACTIONAL_SERVING}(?:[ \\t]*,[^()£\\r\\n]*)?\\s*\\)|${FRACTIONAL_SERVING})(?=\\s|${PRICE_ITEM_SEPARATOR.source}|$)`, "i",
);
const LEADING_FRACTION_TOKEN = new RegExp(
  `^\\s*\\(?\\s*(?:${FRACTIONAL_BEER_MEASURE.source})(?=\\s|[()-]|${PRICE_ITEM_SEPARATOR.source}|$)`, "i",
);
const FRACTIONAL_PRICE_DISCOUNT = new RegExp(
  `(?:\\([ \\t]*)?(?:${FRACTIONAL_BEER_MEASURE.source})[ \\t]*\\)?[ \\t]*(?:off\\b(?![ \\t-]+menu\\b)|discount(?:ed)?\\b)(?:[ \\t]+offer\\b)?`, "i",
);
const VAGUE_NAME = /^(about|around|roughly|approximately|only|from|just|under|over)$/i;
export const SERVING_WORD = "pints?|halves|half|schooners?|two[\\s-]thirds|kegs?|bottles?|cans?|glasses|glass|measures|measure";
export const SERVING_SIZE = new RegExp(`\\b(?:${SERVING_WORD}|\\d{2,4}\\s*ml)\\b`, "i");
const POUR_OF = new RegExp(`^(?:(?:a|an)\\s+)?(?:pints?|half|measures?|schooners?|${FRACTIONAL_PINT_MEASURE.source}|${FRACTIONAL_BEER_MEASURE.source}|glass(?:es)?|bottles?|cans?)\\s+of\\s+(?:(?:a|an)\\s+)?(.+)$`, "i");

export function cleanListedDrinkName(label: string): string | null {
  const poured = label.replace(/^[/|\s]+/, "").trim().match(POUR_OF);
  const source = poured?.[1]?.trim() ?? label;
  const cleaned = source
    .replace(/\bschooners?\b(?:\s*\([^)]*\))?/gi, " ")
    .replace(new RegExp(`\\(?\\s*(?:${FRACTIONAL_PINT_MEASURE.source}|${FRACTIONAL_BEER_MEASURE.source})\\s*\\)?`, "gi"), " ")
    .replace(/(?:½|\b1\/2\b)(?:\s+of\s+a)?(?:\s+pints?\b)?/gi, " ")
    .replace(/\b\d{2,4}\s*ml\b/gi, " ")
    .replace(new RegExp(`\\b(?:${SERVING_WORD})(?:\\s+of(?:\\s+a)?)?\\b`, "gi"), " ")
    .replace(/[/|]+/g, (mark, offset, source) => (
      mark === "/"
      && /(?:19|20)\d{2}$/.test(source.slice(Math.max(0, offset - 4), offset))
      && /^\d{2}(?!\d)/.test(source.slice(offset + 1))
        ? "/"
        : " "
    ))
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "")
    .trim();
  if (cleaned.length < 2 || VAGUE_NAME.test(cleaned)) return null;
  return cleaned;
}

const NEXT_UK_PRICE = new RegExp(UK_PRICE_PATTERN.source, "i");
const FULL_PINT_WORD = /\b(?:pints?|568\s*ml)\b/i;
const TRAILING_FULL_PINT = new RegExp(
  `^(?:[ \\t]+|[ \\t]*\\/[ \\t]*)(?:pints?|568[ \\t]*ml)\\b(?=\\s*$|\\s*${PRICE_ITEM_SEPARATOR.source})`, "i",
);

type FractionGap = {
  suffix: string;
  disputedEarlier?: boolean;
  disputedLater?: boolean;
};

function statesFullPint(label: string): boolean {
  return FULL_PINT_WORD.test(label) && !FRACTIONAL_BEER_MEASURE.test(label)
    && !isHalfMeasure(label) && !isBottledMeasure(label);
}

function namesPricedItem(label: string): boolean {
  return /\p{L}/u.test(label.replace(FULL_PINT_WORD, ""));
}

const OFFER_SERVING_QUALIFIER = /^\s*(?:(?:on|all|selected)\s+)*(?:draught|draft|cask|keg|tap|beers?|lagers?|ales?|pints?)(?:\s+(?:beers?|lagers?|ales?|pints?))?\s*$/i;

/** A clear boundary after a discount suffix, before the next price. */
function offerSuffixBoundary(afterOffer: string): number {
  if (LEADING_PRICE_ITEM_SEPARATORS.test(afterOffer)) return 0;
  const hardBoundary = afterOffer.search(/[;|]/);
  if (hardBoundary >= 0) return hardBoundary;
  // A soft separator ends a recognised serving qualifier. A period inside
  // a printed name, such as St. Austell, does not prove a new priced item.
  const boundary = afterOffer.search(/[.,!?](?=\s*[\p{L}\p{N}])/u);
  if (boundary < 0 || !OFFER_SERVING_QUALIFIER.test(afterOffer.slice(0, boundary))) return -1;
  const nextLabel = afterOffer.slice(boundary + 1);
  return statesFullPint(nextLabel) && namesPricedItem(nextLabel) ? boundary : -1;
}

/** The end of the earlier item's offer within one gap between printed prices. */
function fractionalOfferSuffixEnd(gap: string, hasLaterPrice: boolean): number | null {
  const offer = FRACTIONAL_PRICE_DISCOUNT.exec(gap);
  if (!offer) return null;
  const offerAt = offer.index;
  // A strong break before the offer ends the earlier item. A colon, comma,
  // or intervening offer wording does not by itself start a new priced item.
  const beforeOffer = gap.slice(0, offerAt);
  if (/[;|]/.test(beforeOffer) || /^[ \t]*[.!?]/.test(beforeOffer)) return null;
  if (!hasLaterPrice) return gap.length;
  const offerEnd = offerAt + offer[0].length;
  const boundary = offerSuffixBoundary(gap.slice(offerEnd));
  if (boundary < 0) return null;
  const splitAt = offerEnd + boundary;
  const followingLabel = gap.slice(splitAt);
  // A colon before an amount can sit inside the next item's offer.
  // A hard break can end a suffix even when the next figure is unnamed.
  return namesPricedItem(followingLabel) || /^\s*[;|]/.test(followingLabel) ? splitAt : null;
}

/** Decide what belongs to the earlier price before reading the next item. */
function fractionalGap(gap: string, earlierLabel: string, laterTail: string | null): FractionGap | null {
  if (laterTail !== null && POUR_OF.test(gap.replace(LEADING_PRICE_ITEM_SEPARATORS, "").trim())) return null;
  const offerEnd = fractionalOfferSuffixEnd(gap, laterTail !== null);
  if (offerEnd !== null) {
    return {
      suffix: gap.slice(0, offerEnd),
      disputedLater: laterTail !== null && !namesPricedItem(gap.slice(offerEnd)),
    };
  }
  const marker = LEADING_FRACTIONAL_BEER_MEASURE.exec(gap)?.[0];
  if (!marker) {
    if (!LEADING_FRACTION_TOKEN.test(gap)) return null;
    return {
      suffix: "",
      disputedEarlier: laterTail === null || !statesFullPint(earlierLabel),
      disputedLater: laterTail !== null,
    };
  }
  const laterLabel = gap.slice(marker.length);
  if (LEADING_PRICE_ITEM_SEPARATORS.test(laterLabel)) {
    return {
      suffix: marker,
      disputedLater: laterTail !== null && !laterLabel.replace(LEADING_PRICE_ITEM_SEPARATORS, "").trim(),
    };
  }
  if (laterTail === null && !laterLabel.trim()) return { suffix: marker };
  // Parentheses do not settle ownership. Keep a pint with its own explicit
  // measure and withhold the adjacent figure when the fraction could be its own.
  if (laterTail !== null && statesFullPint(earlierLabel)) {
    return { suffix: "", disputedLater: true };
  }
  if (laterTail !== null && laterLabel.trim()
    && (statesFullPint(laterLabel) || TRAILING_FULL_PINT.test(laterTail))) {
    return { suffix: marker, disputedEarlier: true };
  }
  return { suffix: "", disputedEarlier: true, disputedLater: laterTail !== null };
}

type PriceFraction = {
  fractional: boolean;
  disputed: boolean;
  suffix: string | null;
  previousSuffixEnd: number | null;
};

function lineFractions(
  line: PrintedMenuLine,
  prices: readonly UkPriceRawCandidate[],
): Array<{ raw: UkPriceRawCandidate; fraction: PriceFraction }> {
  let previousEnd = 0;
  let previousLabel = "";
  return prices.map((price, index) => {
    const at = price.at - line.start;
    const end = at + price.verbatim.length;
    const before = line.text.slice(previousEnd, at);
    const remainder = line.text.slice(end);
    const previous = index > 0 ? fractionalGap(before, previousLabel, remainder) : null;
    const label = before.slice(previous?.suffix.length ?? 0).replace(LEADING_PRICE_ITEM_SEPARATORS, "");
    const next = prices[index + 1];
    const nextAt = next ? next.at - line.start : line.text.length;
    const after = fractionalGap(
      line.text.slice(end, nextAt),
      label,
      next ? line.text.slice(nextAt + next.verbatim.length) : null,
    );
    const fraction = {
      fractional: FRACTIONAL_BEER_MEASURE.test(label) || Boolean(after?.suffix),
      disputed: Boolean(previous?.disputedLater || after?.disputedEarlier),
      suffix: after?.suffix ?? null,
      previousSuffixEnd: previous?.suffix ? line.start + previousEnd + previous.suffix.length : null,
    };
    previousEnd = end;
    previousLabel = label;
    return { raw: price, fraction };
  });
}

type OwnedFractionalOffer = { priceAt: number; start: number; end: number };

function delimitedOfferClause(text: string, priorEnd: number, start: number, end: number, boundary: number): PrintedSpan {
  let clauseStart = priorEnd;
  for (const separator of text.slice(priorEnd, start).matchAll(new RegExp(PRICE_ITEM_SEPARATOR.source, "g"))) {
    const after = priorEnd + (separator.index ?? 0) + separator[0].length;
    // A colon directly introducing the discount stays inside its clause.
    if (separator[0] === ":" && !text.slice(after, start).trim()) continue;
    clauseStart = after;
  }
  const following = PRICE_ITEM_SEPARATOR.exec(text.slice(end, boundary));
  return { start: clauseStart, end: following ? end + following.index : boundary };
}

/** Locate the offer text only when it belongs to a printed price. */
function fractionalOfferOwner(text: string, start: number, end: number): OwnedFractionalOffer | null {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
  const prior = [...before.matchAll(UK_PRICE_PATTERN)].at(-1);
  const next = NEXT_UK_PRICE.exec(after);
  const priorAt = lineStart + (prior?.index ?? 0);
  const priorEnd = priorAt + (prior?.[0].length ?? 0);
  const nextAt = end + (next?.index ?? after.length);
  let nextItemStart = priorEnd;
  if (prior) {
    const suffixEnd = fractionalOfferSuffixEnd(text.slice(priorEnd, nextAt), next !== null);
    if (suffixEnd !== null) {
      const boundary = priorEnd + suffixEnd;
      if (end <= boundary) {
        const following = text.slice(boundary, nextAt);
        const separator = LEADING_PRICE_ITEM_SEPARATORS.exec(following);
        const delimited = next && separator && (/[;|]/.test(separator[0])
          || namesFullPint(following.slice(separator[0].length), ""));
        return {
          priceAt: priorAt,
          ...(delimited ? delimitedOfferClause(text, priorEnd, start, end, boundary) : { start, end }),
        };
      }
      // A second offer can be part of the next named item, after this suffix.
      nextItemStart = boundary;
    }
  }
  if (next && (!prior || LEADING_PRICE_ITEM_SEPARATORS.test(text.slice(nextItemStart, start)))) {
    return { priceAt: nextAt, start, end };
  }
  return null;
}

function fractionalOfferOwners(text: string, context: string, contextStart: number): Array<OwnedFractionalOffer | null> {
  return Array.from(context.matchAll(new RegExp(FRACTIONAL_PRICE_DISCOUNT.source, "gi")), (match) => {
    const start = contextStart + (match.index ?? 0);
    return fractionalOfferOwner(text, start, start + match[0].length);
  });
}

function priceHasOffer(text: string, at: number, context: string, contextStart: number): boolean {
  if (!FRACTIONAL_PRICE_DISCOUNT.test(context)) return OFFER_WORDS.test(context);
  let otherOfferWords = context;
  for (const owner of fractionalOfferOwners(text, context, contextStart)) {
    if (!owner || owner.priceAt === at) return true;
    // Mask the proven clause at its source width. Leave unresolved words visible.
    const from = Math.max(0, owner.start - contextStart);
    const to = Math.min(context.length, owner.end - contextStart);
    otherOfferWords = otherOfferWords.slice(0, from) + " ".repeat(to - from) + otherOfferWords.slice(to);
  }
  return OFFER_WORDS.test(otherOfferWords);
}

// A zero-strength claim in the printed item name beats spirit or cocktail
// words in its description. Keep the marker close to the name so a 0.0%
// ingredient later in a long description cannot relabel the whole drink.
const ZERO_ALCOHOL_TITLE_MAX_OFFSET = 24;

const SOUR_BEER_STYLE = /\bsour\s+(?:ipa|pale ale|ale|lager|stout|beer|gose)\b|\b(?:ipa|ale|beer|gose)\s+sour\b/gi;

const SPIRIT_CATEGORIES: readonly DrinkCategory[] = ["whisky", "gin", "vodka", "rum", "shot"];

function categoriesNamedIn(text: string): Set<DrinkCategory> {
  const withoutSoftDrinkBeerWords = text.replace(
    new RegExp(SOFT_DRINK_WEARING_A_BEER_WORD.source, "gi"),
    " ",
  );
  return new Set(
    CATEGORY_WORDS.filter((row) => row.pattern.test(withoutSoftDrinkBeerWords)).map((row) => row.category),
  );
}

type PrintedItemName = {
  /** The figure's own line up to the figure. */
  own: string;
  /** Unpriced lines since the previous figure, inside the reader's window. */
  preceding: string[];
};

/**
 * The printed name of the item a figure belongs to. A line that already
 * carried a figure begins with the previous item's text, so it names no item
 * start and the title rules below do not apply.
 */
function printedItemName(text: string, at: number): PrintedItemName | undefined {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const line = text.slice(lineStart, at);
  if (/£\s?\d/.test(line)) return undefined;
  const windowStart = Math.max(0, at - PRICE_CONTEXT_CHARS);
  const before = text.slice(windowStart, lineStart);
  const lastFigure = [...before.matchAll(UK_PRICE_PATTERN)].at(-1);
  const since = lastFigure ? before.slice((lastFigure.index ?? 0) + lastFigure[0].length) : before;
  return {
    own: line.trim(),
    preceding: since.split("\n").map((part) => part.trim()).filter(Boolean),
  };
}

function titleCategory(name: string): DrinkCategory | null {
  if (itemNameStatesZeroAlcohol(name)) return "alcohol-free";
  return itemNameStatesCocktail(name) ? "cocktail" : null;
}

function itemNameStatesZeroAlcohol(itemName: string): boolean {
  const marker = ZERO_ALCOHOL_MARKER.exec(itemName)
    ?? /\b0\.0\s+AF\b/i.exec(itemName)
    ?? /\b(?:alcohol[- ]free|non[- ]alcoholic)\b/i.exec(itemName);
  if (!marker || marker.index > ZERO_ALCOHOL_TITLE_MAX_OFFSET) return false;
  const firstComma = itemName.indexOf(",");
  return firstComma < 0 || marker.index < firstComma;
}

function itemNameStatesCocktail(itemName: string): boolean {
  // An early cocktail word is the printed drink name, even when a later
  // ingredient names a spirit closer to the figure. Keep this to the opening
  // 24 characters to keep later description words from deciding the title.
  // "Sour IPA" and "Wild Sour Ale" are beer styles, not cocktails.
  const name = itemName.replace(SOUR_BEER_STYLE, " ");
  return categoryDecisionFor(name.slice(0, 24), 0)?.category === "cocktail";
}

export type UkPriceCandidate = {
  priceGbp: number;
  category: DrinkCategory;
  /** The exact substring the page carried, kept for the verbatim check. */
  verbatim: string;
  /** The text either side, which is what the category and food words are read from. */
  context: string;
  /** Trimmed printed menu text beside the figure, when the page named the drink. */
  drinkLabel?: string;
  servingSize?: string;
};

export type UkPriceCategoryRow = {
  category: DrinkCategory;
  priceGbp: number;
  drinkLabel?: string;
  servingSize?: string;
};

const UK_PRICE_DRINK_LABEL_MAX = 80;

function normalizeHarvestDrinkLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= UK_PRICE_DRINK_LABEL_MAX) return trimmed;
  return trimmed.slice(0, UK_PRICE_DRINK_LABEL_MAX);
}

/**
 * The menu text immediately before a verbatim £ figure inside the reader's
 * context window. This is what site-harvest rows carry as `drinkLabel`.
 */
export function drinkLabelFromPriceContext(
  context: string,
  verbatim: string,
  priceAtInContext = context.indexOf(verbatim),
): string | null {
  const priceAt = priceAtInContext;
  if (priceAt < 0) return null;
  context = context.replace(/\n/g, " ");

  const before = context.slice(0, priceAt);
  let start = 0;
  const priorPrices = [...before.matchAll(UK_PRICE_PATTERN)];
  const last = priorPrices.at(-1);
  if (last) {
    start = (last.index ?? 0) + last[0].length;
  }
  for (const sep of [". ", "; ", " | ", "| ", " - ", " - "]) {
    const at = before.lastIndexOf(sep, priceAt);
    if (at >= start) start = at + sep.length;
  }

  // A price list printed inline ("Cans (Coke £3.30, Coke Zero £3, ...)") leaves
  // the list's own separator in front of every item after the first.
  const raw = context
    .slice(start, priceAt)
    .replace(/\s+/g, " ")
    .trim();
  return normalizeHarvestDrinkLabel(raw.replace(/^[,;:•·]+\s*/, ""));
}

/** Tea, water and affogato never file as coffee, judged on the own line and its item lines. */
export function coffeePriceExcludedAt(
  text: string,
  at: number,
  drinkLabel?: string | null,
): boolean {
  const printed = printedItemName(text, at);
  if (!printed) return coffeePriceLabelExcluded(drinkLabel);
  return coffeePriceLabelExcluded(printed.own, printed.preceding);
}

/**
 * Dedup key for site-harvest rows: category, printed name and explicit serving.
 * A coffee printed as exactly a pilot drink keys by that drink, so flat white,
 * latte and matcha latte each keep their own figure.
 */
export function siteHarvestPriceKey(
  category: DrinkCategory,
  drinkLabel?: string | null,
  servingSize?: string | null,
): string {
  const name = category === "coffee" ? canonicalCoffeePilotDrink(drinkLabel) ?? drinkLabel : drinkLabel;
  const label = typeof name === "string" ? name.trim().toLowerCase() : "";
  const serving = typeof servingSize === "string" ? servingSize.trim().toLowerCase() : "";
  return `${category}\0${label}\0${serving}`;
}

function statedWineMeasure(label: string | undefined): { drinkLabel: string; servingSize: string } | null {
  const match = label?.match(/^(.*?)(?:\s+)?(\d{2,3}\s*ml)$/i);
  if (!match) return null;
  return {
    drinkLabel: (match[1] ?? "").replace(/^[/|\s\u2013\u2014-]+$/, "").trim(),
    servingSize: (match[2] ?? "").replace(/\s+/g, "").toLowerCase(),
  };
}

export function statedWineIdentity(
  context: string,
  verbatim: string,
  priceAt: number,
): { drinkLabel: string; servingSize: string } | null {
  const itemStart = context.lastIndexOf("\n", priceAt - 1) + 1;
  context = context.slice(itemStart);
  priceAt -= itemStart;
  let candidateAt = priceAt;
  let currentMeasure: string | null = null;
  // A wine's subsequent glass figures carry only their own printed measure.
  // Walk back across adjacent measure/price pairs, never across another name.
  for (let i = 0; i < 3; i += 1) {
    const price = i === 0
      ? verbatim
      : context.slice(candidateAt).match(new RegExp(`^(?:${UK_PRICE_PATTERN.source})`, "i"))?.[0];
    if (!price) return null;
    const measure = statedWineMeasure(drinkLabelFromPriceContext(context, price, candidateAt) ?? undefined);
    if (!measure) return null;
    currentMeasure ??= measure.servingSize;
    if (measure.drinkLabel) return { drinkLabel: measure.drinkLabel, servingSize: currentMeasure };
    const prior = [...context.slice(0, candidateAt).matchAll(UK_PRICE_PATTERN)].at(-1);
    if (!prior) return null;
    candidateAt = prior.index ?? 0;
  }
  return null;
}

/** One £ figure on a page before category judgment (TypeSafe or regex). */
export type UkPriceRawCandidate = {
  priceGbp: number;
  verbatim: string;
  /** Page text ±120 chars around the figure for judgment state. */
  snippet: string;
  priceText: string;
  /**
   * WHERE ON THE PAGE THIS FIGURE WAS, AND WHY IT IS CARRIED.
   *
   * A page prices two different things at the same figure all the time: a pint
   * at £6.20 and a supper at £6.20. `verbatim` cannot tell them apart, so a
   * keyless re-read that searched for the string would read BOTH candidates in
   * the context of whichever came first -- publishing the pint's category for
   * the supper's figure, and publishing the pint twice. The offset is the only
   * thing that distinguishes them, so it travels with the candidate.
   */
  at: number;
};

export type UkPriceReading = {
  kept: UkPriceCandidate[];
  drops: UkPriceDropReason[];
};

function normalizeHtmlTextWhitespace(source: string): string {
  if (!/<[a-z!/]/i.test(source)) return source;
  const document = parseFragment(source, { sourceCodeLocationInfo: true });
  const ranges: Array<{ start: number; end: number }> = [];
  function visit(node: HtmlNode, insideElement = false): void {
    const children = htmlChildren(node);
    const ownsHtmlText = insideElement || isHtmlElement(node);
    for (const [index, child] of children.entries()) {
      const before = children[index - 1];
      const after = children[index + 1];
      const betweenElements = before !== undefined && after !== undefined &&
        isHtmlElement(before) && isHtmlElement(after);
      if (child.nodeName === "#text" && "value" in child && child.sourceCodeLocation &&
        (ownsHtmlText || (betweenElements && /^\s+$/.test(child.value)))) {
        ranges.push({ start: child.sourceCodeLocation.startOffset, end: child.sourceCodeLocation.endOffset });
      }
      visit(child, ownsHtmlText);
    }
  }
  visit(document);
  const pieces: string[] = [];
  let cursor = 0;
  for (const { start, end } of ranges.sort((a, b) => a.start - b.start)) {
    if (start < cursor) continue;
    pieces.push(source.slice(cursor, start), source.slice(start, end).replace(/\s+/g, " "));
    cursor = end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

export type UkPriceSourceFormat = "html" | "text";

/**
 * MARKDOWN IS LAYOUT, NOT WORDS. A rendered page and an extract reach this
 * reader as Markdown, and its syntax used to survive into drink names: a
 * heading's `####` made "#### Coke / Diet Coke" a different drink from the
 * same line served as HTML, and a link's target URL sat beside the price it
 * wrapped. An image is not text a drinker reads, a link reads as its own
 * words, and heading, emphasis and escape marks are dropped. Runs before
 * whitespace is collapsed, while line starts still exist.
 */
const HEADING_MARKERS = "\u0010\u0011\u0012\u0013\u0014\u0015";
const OPEN_CONTAINER_MARKER = "\u0016";
const CLOSE_CONTAINER_MARKER = "\u0017";
const OPEN_ITEM_HOST_MARKER = "\u0018";
const CLOSE_ITEM_HOST_MARKER = "\u0019";
const OPEN_ITEM_MARKER = "\u001a";
const CLOSE_ITEM_MARKER = "\u001b";
const OPEN_SOFT_CONTAINER_MARKER = "\u001c";
const CLOSE_SOFT_CONTAINER_MARKER = "\u001d";

function headingMarker(level: number): string {
  return HEADING_MARKERS.charAt(level - 1);
}

function markdownAsText(source: string, keepHeadingOrigins: boolean): string {
  return source
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(#{1,6})[ \t]+/gm, (_match, marks: string) =>
      keepHeadingOrigins ? headingMarker(marks.length) : "")
    .replace(/[ \t]+#+[ \t]*$/gm, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

/**
 * Strip a page to the text a reader sees. Scripts and styles go first, because
 * a price inside a JSON blob or a CSS rule is not something the page states.
 */
export function pageText(
  html: string,
  preserveItemBoundaries = false,
  sourceFormat: UkPriceSourceFormat = "text",
): string {
  return readPageText(html, preserveItemBoundaries, sourceFormat);
}

type PrintedContainerBreak = { sharedDepth: number; nextDepth: number };

type PrintedPage = {
  text: string;
  structuralBreaks: ReadonlySet<number>;
  inlineBreaks: ReadonlySet<number>;
  headings: ReadonlyMap<number, number>;
  containerBreaks: ReadonlyMap<number, PrintedContainerBreak>;
};

export function printedPageText(
  html: string,
  sourceFormat: UkPriceSourceFormat = "text",
  options?: { preserveSourceLines?: boolean },
): PrintedPage {
  const breaks = {
    structural: new Set<number>(),
    inline: new Set<number>(),
    headings: new Map<number, number>(),
    containers: new Map<number, PrintedContainerBreak>(),
  };
  const text = readPageText(html, true, sourceFormat, breaks, options?.preserveSourceLines);
  return {
    text, structuralBreaks: breaks.structural, inlineBreaks: breaks.inline, headings: breaks.headings,
    containerBreaks: breaks.containers,
  };
}

function readPageText(
  html: string,
  preserveItemBoundaries: boolean,
  sourceFormat: UkPriceSourceFormat,
  breaks?: {
    structural: Set<number>;
    inline: Set<number>;
    headings: Map<number, number>;
    containers: Map<number, PrintedContainerBreak>;
  },
  preserveSourceLines = false,
): string {
  // Keep one character per break so judged candidates keep their fallback offsets.
  const structuralBreak = breaks ? "\v" : "\n";
  const inlineBreak = breaks ? "\f" : "\n";
  const visibleCodePoint = (code: number) => code === 11 || code === 12 || (code >= 16 && code <= 29)
    ? " " : String.fromCodePoint(code);
  const tagged = html.replace(/[\u0010-\u001d]/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const visibleSource = sourceFormat === "text" ? markdownAsText(tagged, Boolean(breaks)) : tagged;
  const source = sourceFormat === "html"
    ? visibleSource.replace(/\s+/g, " ")
    : preserveItemBoundaries && !preserveSourceLines
      ? normalizeHtmlTextWhitespace(visibleSource)
      : visibleSource;
  const visibleText = source
    .replace(/\s+/g, (space) => {
      if (!preserveItemBoundaries || !/[\r\n]/.test(space)) return " ";
      const lineEndings = space.match(/\r\n|[\r\n]/g);
      return breaks && lineEndings && lineEndings.length > 1 ? structuralBreak : "\n";
    })
    .replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) =>
      breaks ? headingMarker(Number(level)) : structuralBreak)
    .replace(/<(\/?)(?:div|section|article|blockquote)\b[^>]*>/gi, (_match, closing: string) => {
      if (!breaks) return structuralBreak;
      return closing ? CLOSE_CONTAINER_MARKER : OPEN_CONTAINER_MARKER;
    })
    .replace(/<(\/?)(?:ul|ol|table|dl)\b[^>]*>/gi, (_match, closing: string) => {
      if (!breaks) return structuralBreak;
      return closing ? CLOSE_ITEM_HOST_MARKER : OPEN_ITEM_HOST_MARKER;
    })
    .replace(/<(\/?)(?:li|tr|dt|dd)\b[^>]*>/gi, (_match, closing: string) => {
      if (!breaks) return structuralBreak;
      return closing ? CLOSE_ITEM_MARKER : OPEN_ITEM_MARKER;
    })
    .replace(/<(\/?)(?:main|aside|nav|header|footer|pre)\b[^>]*>/gi, (_match, closing: string) => {
      if (!breaks) return " ";
      return closing ? CLOSE_SOFT_CONTAINER_MARKER : OPEN_SOFT_CONTAINER_MARKER;
    })
    .replace(/<\/?(?:p|h[1-6])\b[^>]*>/gi, structuralBreak)
    .replace(/<\/?br(?=[\s/>])[^>]*>/gi, preserveItemBoundaries ? inlineBreak : " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    // A NUMERIC REFERENCE IS THE CHARACTER IT NAMES, and leaving it undecoded
    // hides drink words: a spirits list states `Bosford Ros&#233;`, which is not
    // a wine to any pattern here, and `&#163;` is not a price to any of them.
    .replace(/&#(\d{1,7});/g, (_, code) => visibleCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => visibleCodePoint(Number.parseInt(code, 16)));
  let removed = 0;
  const scopes: Array<"container" | "item-host" | "item"> = [];
  return visibleText.replace(/[\s\u0010-\u001d]+/g, (space: string, offset: number) => {
    if (offset + space.length === visibleText.length) return "";
    const heading = breaks && space.match(/[\u0010-\u0015]/g)?.at(-1);
    const level = heading ? HEADING_MARKERS.indexOf(heading) + 1 : undefined;
    const index = offset === 0 ? -1 : offset - removed;
    const containers = breaks && space.match(/[\u0016-\u001d]/g);
    if (breaks && containers) {
      let sharedDepth = scopes.length;
      for (const marker of containers) {
        if (marker === OPEN_CONTAINER_MARKER || marker === OPEN_SOFT_CONTAINER_MARKER) {
          scopes.push("container");
        } else if (marker === OPEN_ITEM_HOST_MARKER) {
          scopes.push("item-host");
        } else {
          const kind = marker === CLOSE_CONTAINER_MARKER || marker === CLOSE_SOFT_CONTAINER_MARKER ? "container"
            : marker === CLOSE_ITEM_HOST_MARKER ? "item-host" : "item";
          const closed = scopes.lastIndexOf(kind);
          const host = kind === "item" ? scopes.lastIndexOf("item-host") : -1;
          // Opening a sibling item also closes an implicitly ended item.
          if (closed > host) {
            scopes.length = closed;
            sharedDepth = Math.min(sharedDepth, closed);
          }
          if (marker === OPEN_ITEM_MARKER) scopes.push("item");
        }
      }
      breaks.containers.set(index, { sharedDepth, nextDepth: scopes.length });
    }
    const blockBreak = level !== undefined || /[\u0016-\u001b]/.test(space) || space.includes(structuralBreak);
    const lineBreak = blockBreak || space.includes(inlineBreak) || (preserveItemBoundaries && space.includes("\n"));
    if (offset === 0) {
      if (level !== undefined) breaks?.headings.set(0, level);
      removed += space.length;
      return "";
    }
    removed += space.length - 1;
    if (breaks) {
      if (level !== undefined) breaks.headings.set(index + 1, level);
      if (blockBreak || (containers && lineBreak)) {
        breaks.structural.add(index);
        return "\n";
      }
      if (space.includes(inlineBreak)) {
        breaks.inline.add(index);
        return "\n";
      }
    }
    return preserveItemBoundaries && space.includes("\n") ? "\n" : " ";
  });
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

function htmlChildren(node: HtmlNode): HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function isMenuSection(node: HtmlElement): boolean {
  if (node.tagName === "section" || node.tagName === "article") return true;
  return node.tagName === "div" && node.attrs.some(
    (attr) => attr.name === "class" && attr.value.split(/\s+/).includes("menubox"),
  );
}

const WINE_SECTION_HEADING = /^(?:white|red|ros[eé]|(?:white|red|ros[eé]) wines?|wines?)$/i;

/** Price ordinals inside a wine section, never its siblings. */
function wineSectionPriceOrdinals(html: string): Set<number> {
  const ordinals = new Set<number>();
  if (!/(?:\bmenubox\b|<section\b|<article\b)/i.test(html)) return ordinals;
  const document = parse(html, { sourceCodeLocationInfo: true });
  const paragraphs: { start: number; text: string }[] = [];

  function visit(node: HtmlNode): void {
    if (isHtmlElement(node) && isMenuSection(node)) {
      const own: HtmlElement[] = [];
      function collect(child: HtmlNode): void {
        if (!isHtmlElement(child)) return;
        if (child !== node && isMenuSection(child)) return;
        own.push(child);
        for (const nested of htmlChildren(child)) collect(nested);
      }
      collect(node);
      let inWineSection = false;
      for (const item of own) {
        if (/^h[1-6]$/.test(item.tagName)) {
          inWineSection = WINE_SECTION_HEADING.test(
            pageText(serializeOuter(item)),
          );
        } else if (item.tagName === "p" && inWineSection) {
          const location = item.sourceCodeLocation;
          if (location?.startOffset == null || !location.endOffset) continue;
          paragraphs.push({
            start: location.startOffset,
            text: pageText(html.slice(location.startOffset, location.endOffset), true),
          });
        }
      }
    }
    for (const child of htmlChildren(node)) visit(child);
  }
  visit(document);

  // One left-to-right pass. Recounting page text from byte 0 at every wine
  // paragraph was quadratic: a 152 KB list spent seconds before it priced.
  paragraphs.sort((left, right) => left.start - right.start);
  let cursor = 0;
  let carry = "";
  let prefixCount = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.start < cursor) continue;
    const counted = countStablePrefixPrices(carry + html.slice(cursor, paragraph.start));
    prefixCount += counted.count;
    carry = counted.carry;
    const count = findUkPriceCandidates(paragraph.text).length;
    for (let index = 0; index < count; index += 1) ordinals.add(prefixCount + index);
    cursor = paragraph.start;
  }
  return ordinals;
}

/**
 * How many complete £ figures sit in `raw`, and the unfinished tail.
 *
 * A prefix that ends on `£` has not stated a price yet. Carrying that tail
 * into the next gap keeps a figure whose pound sign and digits straddle a
 * cut in the count, without rereading the bytes already passed.
 */
function countStablePrefixPrices(raw: string): { count: number; carry: string } {
  const text = pageText(raw);
  const incomplete = /£\s?$/.exec(text);
  const stable = incomplete ? text.slice(0, incomplete.index ?? text.length) : text;
  const count = findUkPriceCandidates(stable).length;
  if (!incomplete) return { count, carry: "" };
  const lower = raw.toLowerCase();
  const poundAt = Math.max(
    raw.lastIndexOf("£"),
    lower.lastIndexOf("&pound;"),
    lower.lastIndexOf("&#163;"),
    lower.lastIndexOf("&#xa3;"),
  );
  return { count, carry: poundAt >= 0 ? raw.slice(poundAt) : "" };
}

/**
 * How far after a `with` a MIXER's own name may sit. "With Britvic Ginger Ale"
 * is the longest shape a pub's spirits list writes, and a span this tight keeps
 * the next line's drink out of it.
 */
const MIXER_NAME_SPAN = 24;

/**
 * Whether the drink word at `index` is the MIXER in a spirit-and-mixer serve.
 *
 * A spirits list states the serve rather than the spirit: "Sailor Jerry With
 * Britvic Ginger Ale £7.00". Two drinks, one figure, and this taxonomy names no
 * such drink, so EVERY reading of that line is a wrong one. Left alone the
 * nearest-word rule published it as a £7 ginger ale, and the same list's "Try
 * with Britvic Bitter Lemon £7.25" as a £7.25 PINT.
 *
 * What is asked is narrow on purpose: does a `with` sit immediately in front of
 * this word. The meal wording that also reads "served with" is already gone by
 * the time this is asked, because the food words are checked first.
 */
function isMixerName(context: string, index: number): boolean {
  const run = context.slice(Math.max(0, index - MIXER_NAME_SPAN), index);
  return /\bwith\b[^.;£]*$/i.test(run);
}

/**
 * The category a figure's own surrounding text names, or null.
 *
 * THE NEAREST WORD WINS, not the first pattern in the table. A drinks list puts
 * its lines next to each other, so the window around "House red wine £7.50"
 * also carries the "pint" from the line above it; testing the table in order
 * would file every wine on the page as a beer. Distance decides, and the table
 * order only breaks a tie.
 *
 * `at` is where the figure sits inside `context`. A caller that does not know
 * measures from the middle, which is where `readVenueDrinkPrices` puts it.
 */
function categoryDecisionFor(
  context: string,
  at = Math.floor(context.length / 2),
): { category: DrinkCategory; fromMixer: boolean } | null {
  let best: { category: DrinkCategory; distance: number; fromMixer: boolean } | null = null;
  for (const row of CATEGORY_WORDS) {
    const pattern = new RegExp(row.pattern.source, `${row.pattern.flags.replace("g", "")}g`);
    for (const match of context.matchAll(pattern)) {
      const index = match.index ?? 0;
      // A drinks line names the drink and THEN the price, so a word before the
      // figure is measured from its end and a word after it from its start.
      const distance = index >= at ? index - at : at - (index + match[0].length);
      if (!best || distance < best.distance) {
        best = { category: row.category, distance, fromMixer: isMixerName(context, index) };
      }
    }
  }
  return best ? { category: best.category, fromMixer: best.fromMixer } : null;
}

export function categoryFor(context: string, at = Math.floor(context.length / 2)): DrinkCategory | null {
  return categoryDecisionFor(context, at)?.category ?? null;
}

/**
 * Every drink price a page STATES, with each rejection counted.
 *
 * A page with no figure at all answers one `no-price-on-page` drop rather than
 * an empty result, because "we read it and it says nothing" is a finding and an
 * empty list is not.
 */
/**
 * Every £ figure on a page, with snippet context only. Over-finds on purpose;
 * TypeSafe or the regex table narrows to drink rows.
 */
export function findUkPriceCandidates(text: string, snippetChars = 120): UkPriceRawCandidate[] {
  const out: UkPriceRawCandidate[] = [];
  for (const match of text.matchAll(UK_PRICE_PATTERN)) {
    const priceGbp = Number(match[1]);
    const verbatim = match[0];
    const at = match.index ?? 0;
    const snippet = text.slice(
      Math.max(0, at - snippetChars),
      at + verbatim.length + snippetChars,
    );
    out.push({ priceGbp, verbatim, snippet, priceText: verbatim, at });
  }
  return out;
}

function categoryDecisionFromLabel(
  drinkLabel: string | undefined,
  itemName: PrintedItemName | undefined,
): ReturnType<typeof categoryDecisionFor> | "item-name-ambiguous" | "no-category-word-nearby" {
  if (!drinkLabel) return null;
  if (itemName) {
    if (/\bsour\b/i.test(itemName.own) && !categoryDecisionFor(itemName.own, itemName.own.length)) {
      return "no-category-word-nearby";
    }
    const ownTitle = titleCategory(itemName.own);
    if (ownTitle) return { category: ownTitle, fromMixer: false };
    const ownCategory = categoryDecisionFor(itemName.own, itemName.own.length)?.category ?? null;
    if (itemName.preceding.some((line) => {
      const precedingTitle = titleCategory(line);
      return precedingTitle !== null && precedingTitle !== ownCategory;
    })) return "item-name-ambiguous";
  }
  const decision = categoryDecisionFor(drinkLabel, drinkLabel.length);
  // A named soda, tea or chai with no category word is not evidence that a
  // neighbouring item's beer, wine, spirit or coffee word belongs to this price.
  if (!decision) {
    return /\b(?:soda|tea|chai)\b/i.test(drinkLabel) && !/\biced\s+tea\b/i.test(drinkLabel)
      ? "no-category-word-nearby"
      : null;
  }
  // "Vodka Cranberry Juice" is a spirit-and-mixer serve like the `with` lines
  // above: two drinks, one figure, and never the price of a soft drink.
  if (decision.category === "soft-drink") {
    const named = categoriesNamedIn(drinkLabel);
    if (SPIRIT_CATEGORIES.some((category) => named.has(category))) {
      return { category: decision.category, fromMixer: true };
    }
  }
  return decision;
}

function normalizePrintedName(label: string): string | null {
  return normalizeHarvestDrinkLabel(label.trim().replace(/^[*_]+|[.*_\s]+$/g, ""));
}

function priceItemIdentity(
  before: string,
  after: string,
  itemName: PrintedItemName | undefined,
): { drinkLabel?: string; decision: ReturnType<typeof categoryDecisionFromLabel> } {
  // A price-first name is evidence only inside the selected item.
  const priceFirst = itemName && /[\p{L}\p{N}]/u.test(after)
    && (!/[\p{L}\p{N}]/u.test(before) || titleCategory(after) === "cocktail");
  const own = priceFirst ? after : before;
  if (itemName && /^[*_]+$/.test(own)) return { decision: "item-name-ambiguous" };
  const drinkLabel = normalizePrintedName(own) ?? undefined;
  const decision = categoryDecisionFromLabel(drinkLabel, itemName && { ...itemName, own });
  if ((priceFirst || (itemName && /[*_]+$/.test(own))) && !decision) {
    return { drinkLabel, decision: "no-category-word-nearby" };
  }
  return { drinkLabel, decision };
}

function categoryPriceDropReason(category: DrinkCategory, priceGbp: number): UkPriceDropReason | null {
  const band = CATEGORY_PRICE_BANDS[category];
  if (!band) return "no-category-word-nearby";
  if (!Number.isFinite(priceGbp) || priceGbp < band.minGbp || priceGbp > band.maxGbp) {
    return "outside-category-band";
  }
  return null;
}

const DRINK_SECTION_HEADING = /^(?:on tap|(?:on )?(?:draught|draft)(?: beers?)?|keg|cask(?: ales?)?|beers?|wines?|cocktails?|soft drinks?|bottled beers?(?: & ciders?)?|cans?)$/i;

/** A section's bottle or can measure lasts until the next printed heading. */
function inBottledSection(text: string, at: number): boolean {
  const itemStart = text.lastIndexOf("\n", at - 1);
  if (itemStart < 0) return false;
  const lines = text.slice(0, itemStart).split("\n");
  for (const line of lines.reverse()) {
    const heading = line.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
    if (!heading || heading.includes("£")) continue;
    const section = /^(?:[A-Z][A-Z \d().%&-]*)(?:\([^)]*\))?$/.test(heading)
      || DRINK_SECTION_HEADING.test(heading);
    if (heading.length <= 80 && section) {
      return isBottledMeasure(heading);
    }
  }
  return false;
}

type PrintedSpan = { start: number; end: number };

const PRINTED_DRINK_STRENGTH = /(?<![\p{L}\p{N}])(?<!\d[.,])\d{1,2}(?:[.,]\d+)?[ \t]*%(?:[ \t]*abv\b)?(?=[\s,.!?()]|$)/giu;

function unpricedFractionToken(line: PrintedMenuLine): string | undefined {
  if (NEXT_UK_PRICE.test(line.text) || FRACTIONAL_PRICE_DISCOUNT.test(line.text)) return undefined;
  return LEADING_FRACTIONAL_BEER_MEASURE.exec(line.text)?.[0];
}

function unpricedFraction(line: PrintedMenuLine): PrintedSpan | null {
  const marker = unpricedFractionToken(line);
  if (!marker) return null;
  const explicit = FRACTIONAL_PINT_MEASURE.exec(marker);
  const remainder = line.text.slice(marker.length).trim();
  if (!explicit && !marker.trimStart().startsWith("(")) return null;
  const measure = explicit ?? FRACTIONAL_BEER_MEASURE.exec(marker);
  if (!measure) return null;
  const from = measure.index;
  const to = from + measure[0].length;
  const detail = (marker.slice(to) + " " + remainder)
    .replace(PRINTED_DRINK_STRENGTH, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/^[\s,()]+|[\s,.!?()]+$/g, "");
  // A token can qualify the adjacent price, but a name on this line
  // identifies a different item. Punctuation does not change that role.
  if (detail && !OFFER_SERVING_QUALIFIER.test(detail) && !/^extra cold$/i.test(detail)) return null;
  return explicit
    ? { start: line.start + from, end: line.start + to }
    : { start: line.start, end: line.start + marker.length };
}

const PRINTED_PINT_UNIT = /(?:\b(?:pints?|568[ \t]*ml)\b[\s.,;:/|()-]*$|^\s*(?:a\s+)?pint\s+of\s+)/i;

function namesFullPint(label: string, tail: string): boolean {
  return namesPricedItem(label) && (
    (PRINTED_PINT_UNIT.test(label) && statesFullPint(label))
    || (TRAILING_FULL_PINT.test(tail) && statesFullPint(`${label} pint`))
  );
}

const DRINKS_LABEL = /\b(drinks?|bars?|beers?|wines?|cocktails?|ale|lager|stout|porter|cider|spirit|whisky|whiskey|gin|rum|vodka)\b/i;
const FOOD_LABEL = /\b(food|kitchen|lunch|dinner|brunch|\beat\b)/i;
const HEADING_FILLER = new Set(["and", "menu", "list"]);

export type MenuKind = "drinks" | "food" | "both";

export function menuKind(value: string): MenuKind | null {
  const food = FOOD_LABEL.test(value);
  const drinks = DRINKS_LABEL.test(value);
  if (food && drinks) return "both";
  if (food) return "food";
  if (drinks) return "drinks";
  return null;
}

function printedMenuHeading(line: string): { kind: "drinks" | "food"; generic: boolean } | null {
  const text = line.replace(/^#{1,6}\s+/, "").replace(/[*_`]+/g, "").trim();
  if (!text || /[£\d.!?]/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0 || words.length > 4) return null;
  const content = words.filter((word) => !HEADING_FILLER.has(word));
  if (content.length === 0) return null;
  const hasFood = content.some((word) => FOOD_LABEL.test(word));
  const hasDrinks = content.some((word) => DRINKS_LABEL.test(word));
  const generic = content.every((word) => FOOD_LABEL.test(word) || DRINKS_LABEL.test(word));
  if (hasDrinks && (!hasFood || generic)) return { kind: "drinks", generic };
  if (hasFood && content.every((word) => FOOD_LABEL.test(word))) return { kind: "food", generic };
  return null;
}

function isRegularDrinksHeading(line: string): boolean {
  const heading = line.trim().replace(/:\s*$/, "");
  if (!/^regular\s+/i.test(heading)) return false;
  const subject = heading.replace(/^regular\s+/i, "");
  const section = printedMenuHeading(subject);
  return section?.kind === "drinks" && section.generic;
}

function explicitHeadingOffer(text: string): RegExpMatchArray | undefined {
  const [offer] = groupOfferMatches(text);
  if (!offer) return undefined;
  const price = NEXT_UK_PRICE.exec(text);
  if (!price) return offer;
  const beforePrice = text.slice(0, price.index);
  // A multi-buy amount is not the serving's own amount.
  if (/\b(?:\d+|two)\s+for\s*$/i.test(beforePrice)) return offer;
  const item = beforePrice.replace(new RegExp(OFFER_WORDS.source, "gi"), " ");
  const name = cleanListedDrinkName(item);
  if (SERVING_SIZE.test(item) && name && hasPrintedName(name)
    && !isPrintedSectionHeading(name) && !OFFER_SERVING_QUALIFIER.test(name)) return undefined;
  return offer;
}

const JOINED_SIZE_LIST = /(?<![\d/.£])\d{2,4}(?:\s*ml)?(?:\s*\/\s*\d{2,4}(?:\s*ml)?)+(?!\s*\/\s*\d)/gi;
const JOINED_PRICE_LIST = new RegExp(`^\\s*((?:${UK_PRICE_PATTERN.source})(?:\\s*\\/\\s*(?:${UK_PRICE_PATTERN.source}))*)`, "i");

type PrintedMeasurePair = {
  start: number;
  end: number;
  measures: Array<{ size: string; span: PrintedSpan }>;
  prices: number[];
  valid: boolean;
};

/** Pair size and amount columns by their printed order and original positions. */
function printedMeasurePairs(line: string, priceOffsets: readonly number[]): PrintedMeasurePair[] {
  const pairs: PrintedMeasurePair[] = [];
  let cursor = 0;
  for (const match of line.matchAll(JOINED_SIZE_LIST)) {
    const start = match.index ?? 0;
    if (start < cursor || !/ml/i.test(match[0])) continue;
    const measures = [...match[0].matchAll(/\d{2,4}/g)].map((token) => {
      const at = start + (token.index ?? 0);
      return { size: token[0] + "ml", span: { start: at, end: at + token[0].length } };
    });
    const measureEnd = start + match[0].length;
    const priceMatch = JOINED_PRICE_LIST.exec(line.slice(measureEnd));
    const end = measureEnd + (priceMatch?.[0].length ?? 0);
    const priceStart = end - (priceMatch?.[1]?.length ?? 0);
    const prices = priceOffsets.filter((at) => at >= priceStart && at < end);
    pairs.push({ start, end, measures, prices, valid: Boolean(priceMatch && prices.length === measures.length) });
    cursor = end;
  }
  return pairs;
}

type PairedServing = {
  label: string;
  size: string;
  name: PrintedSpan;
  measure: PrintedSpan;
};

type PrintedMenuLine = { start: number; text: string };
type PricedMenuPart = PrintedMenuLine & { priceOffsets: number[]; menuSection: "drinks" | "food" | null };
type ScopedHeading = { depth: number; level: number };

function scopedHeadingValue<T>(stack: readonly (ScopedHeading & { value: T | undefined })[]): T | undefined {
  let outerLevel = Infinity;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (!entry || entry.level >= outerLevel) continue;
    if (entry.value !== undefined) return entry.value;
    outerLevel = entry.level;
  }
  return undefined;
}

function trimHeadings(stack: ScopedHeading[], depth: number, level?: number): void {
  let previous = stack.at(-1);
  while (previous && (previous.depth > depth
    || (level !== undefined && previous.depth === depth && previous.level >= level))) {
    stack.pop();
    previous = stack.at(-1);
  }
}

type ItemCategory = { category: DrinkCategory; source: "item" | "inherited" };
type PriceAdmission =
  | { kind: "accepted"; category: ItemCategory }
  | { kind: "unclassified"; allowUkContext: boolean }
  | {
    kind: "refused";
    drop: UkPriceDropReason;
    category?: ItemCategory | { category: "beer"; source: "pint" };
    allowUkContext?: boolean;
  };

export type PrintedPriceEvidence = {
  raw: UkPriceRawCandidate;
  line: PrintedSpan;
  name: PrintedSpan;
  description: PrintedSpan;
  leadingDescription?: PrintedSpan;
  scopedOffer?: PrintedSpan;
  pair?: PairedServing;
  label: string;
  tail: string;
  statedWine: ReturnType<typeof statedWineIdentity>;
  wine: ReturnType<typeof statedWineIdentity>;
  admission: PriceAdmission;
  fraction: PriceFraction;
  qualifier?: PrintedSpan;
  fullPint: boolean;
  independentDrink: boolean;
};

type PrintedPriceLayout = {
  lines: PricedMenuPart[];
  prices: ReadonlyMap<number, PrintedPriceEvidence>;
};

function isPrintedSectionHeading(line: string): boolean {
  const title = line.replace(/[\s.,;:!?()-]+$/g, "");
  return DRINK_SECTION_HEADING.test(title) || WINE_SECTION_HEADING.test(title)
    || printedMenuHeading(title)?.generic === true;
}

const NON_DRINK_GOODS = /\b(?:glassware|drinkware|tankards?|steins?|tumblers?|goblets?|mugs?|coasters?|souvenirs?|keyrings?|t[ -]?shirts?|hoodies?|posters?)\b(?![ \t]+of\b)/i;
const GLASS_PRODUCT = /\b(?:(?:pints?|568[ \t]*ml|commemorative)[ \t]+glass(?:es)?\b(?!\s+of\b)|glass(?:es)?[ \t]+568[ \t]*ml\b)/i;

function namesGoods(text: string): boolean {
  return NON_DRINK_GOODS.test(text) || GLASS_PRODUCT.test(text);
}

function hasFoodWords(text: string): boolean {
  return FOOD_WORDS.test(text) || FOOD_WEARING_A_DRINK_WORD.test(text);
}

const DESCRIPTION_PREFIX = /^(?:served(?:\s+with\b|\s*$)|with(?:\s+a\b|\s*$)|when\s+you\b)/i;
const ITEM_DESCRIPTION_LINK = /\b(?:served\s+with|only\s+with|with\s+a|when\s+you)\b/gi;

function finishesDescription(prefix: string, following: string): boolean {
  return /\bwith(?: a)?$/i.test(prefix) || (/\bserved$/i.test(prefix) && /^with\b/i.test(following));
}

function joinsFractionalDiscount(before: string, after: string): boolean {
  const discount = FRACTIONAL_PRICE_DISCOUNT.exec(before + " " + after);
  return discount !== null && discount.index < before.length
    && discount.index + discount[0].length > before.length;
}

export const GLASS_ML = new Set(["125ml", "175ml", "250ml"]);

const LEADING_SERVING = new RegExp("^(?:" + SERVING_WORD + "|\\d{2,4}\\s*ml|½|1/2)\\b", "i");

function hasPrintedName(text: string): boolean {
  return /\p{L}/u.test(cleanListedDrinkName(text) ?? "");
}

function startsPrintedDrinkName(text: string, explicitBoundary = false): boolean {
  const head = (text.replace(/^[/|\s]+/, "").split("£", 1)[0] ?? "").trim();
  if (POUR_OF.test(head)) return true;
  if (LEADING_FRACTION_TOKEN.test(head)) return explicitBoundary && hasPrintedName(head);
  const serving = LEADING_SERVING.exec(head)?.[0];
  if (!serving) return hasPrintedName(head);
  // A numeric measure before a recognised drink is its own priced label.
  const name = cleanListedDrinkName(head);
  return /^\d{2,4}\s*ml$/i.test(serving) && Boolean(name && categoryFor(name) !== null);
}

type PriceGap = { owned: string; unassigned: string; nextStart?: number; startsItem?: boolean };

function startsNamedDiscountedItem(text: string): boolean {
  const discount = FRACTIONAL_PRICE_DISCOUNT.exec(text);
  if (!discount) return false;
  const ordinary = OFFER_WORDS.exec(text);
  const name = text.slice(0, Math.min(discount.index, ordinary?.index ?? Infinity));
  return !/[;|,]/.test(name) && hasPrintedName(name) && SERVING_SIZE.test(name);
}

function selectPriceGap(gap: string, hasNextPrice: boolean): PriceGap {
  const atSeparator = (at: number, length: number): PriceGap => {
    const nextStart = at + length;
    return {
      owned: gap.slice(0, at),
      unassigned: "",
      nextStart,
      startsItem: hasNextPrice && startsPrintedDrinkName(gap.slice(nextStart), true),
    };
  };
  const hard = /[;|]/.exec(gap);
  if (hard) return atSeparator(hard.index, hard[0].length);
  if (!hasNextPrice) return { owned: gap, unassigned: "" };

  const offerEnd = fractionalOfferSuffixEnd(gap, true);
  const remainder = offerEnd === null ? "" : gap.slice(offerEnd);
  const offerBoundary = LEADING_PRICE_ITEM_SEPARATORS.exec(remainder);
  if (offerEnd !== null && offerBoundary) return atSeparator(offerEnd, offerBoundary[0].length);

  let first: RegExpMatchArray | undefined;
  for (const boundary of gap.matchAll(new RegExp(PRICE_ITEM_SEPARATOR.source, "g"))) {
    const at = boundary.index ?? 0;
    const prefix = gap.slice(0, at);
    const sibling = gap.slice(at + boundary[0].length);
    if (/[.!?]/.test(boundary[0])) {
      const pricedServing = TRAILING_FULL_PINT.test(prefix);
      if (!/^\s+\p{L}/u.test(sibling) && !(pricedServing && LEADING_SERVING.test(sibling.trimStart()))) continue;
      if (prefix.trim() && !pricedServing && !namesGoods(prefix)) continue;
    }
    if (!namesPricedItem(sibling)) continue;
    if ((OFFER_WORDS.test(sibling) || FRACTIONAL_PRICE_DISCOUNT.test(sibling))
      && !startsNamedDiscountedItem(sibling)) continue;
    if (!first) {
      first = boundary;
    } else if (namesGoods(gap.slice(first.index, at))) {
      const name = cleanListedDrinkName(sibling);
      const category = name ? categoryDecisionFromLabel(name, undefined) : null;
      if ((category && typeof category !== "string" && !category.fromMixer) || namesFullPint(sibling, "")) {
        return atSeparator(at, boundary[0].length);
      }
    }
  }
  if (first) return atSeparator(first.index ?? 0, first[0].length);

  // An unseparated gap can supply the next printed name, but it cannot
  // contribute a serving or description to the previous price.
  const startsItem = /^\s/.test(gap) && !OFFER_WORDS.test(gap) && startsPrintedDrinkName(gap);
  return { owned: "", unassigned: startsItem ? "" : gap, nextStart: 0, startsItem };
}

function printedHeadStart(text: string, start: number, end: number): number {
  const prefix = text.slice(start, end);
  let selected = start;
  for (const separator of prefix.matchAll(/;\s*|\s*\|\s*|\s+-\s+|(?<=[a-z]{3}|\d)[.!?]\s+/gi)) {
    const after = (separator.index ?? 0) + separator[0].length;
    if (hasPrintedName(prefix.slice(after))) selected = start + after;
  }
  return selected;
}

type SelectedPrice = {
  raw: UkPriceRawCandidate;
  nameStart: number;
  tail: string;
  unassigned: string;
  startsItem: boolean;
  startsTitle: boolean;
  fraction: PriceFraction;
  leadingDescription?: PrintedSpan;
  continuationEnd?: number;
  scopedOffer?: PrintedSpan;
};

function selectLinePrices(
  line: PrintedMenuLine,
  prices: readonly UkPriceRawCandidate[],
): SelectedPrice[] {
  let start = line.start;
  let startsItem = true;
  let startsTitle = true;
  return lineFractions(line, prices).map(({ raw, fraction }, index) => {
    const next = prices[index + 1];
    const priceEnd = raw.at + raw.verbatim.length;
    const rawGap = line.text.slice(priceEnd - line.start, next ? next.at - line.start : undefined);
    const gap = selectPriceGap(rawGap, Boolean(next));
    const nameStart = printedHeadStart(
      line.text, Math.max(start, fraction.previousSuffixEnd ?? start) - line.start, raw.at - line.start,
    ) + line.start;
    const selected = { raw, nameStart, tail: gap.owned, unassigned: gap.unassigned, startsItem, startsTitle, fraction };
    start = priceEnd + (gap.nextStart ?? 0);
    startsItem = gap.startsItem === true;
    startsTitle = startsItem && (gap.nextStart ?? 0) > 0;
    return selected;
  });
}

function preServingAdmission(
  text: string,
  line: PrintedMenuLine,
  selection: SelectedPrice,
  before: string,
  identity: ReturnType<typeof priceItemIdentity>,
  stated: ReturnType<typeof statedWineIdentity>,
  wine: ReturnType<typeof statedWineIdentity>,
  fullPint: boolean,
  source: ItemCategory["source"],
  malformedPair: boolean,
): PriceAdmission {
  const { raw, tail, unassigned, fraction } = selection;
  const { drinkLabel, decision } = identity;
  const label = drinkLabel ?? before;
  const categoryName = typeof decision === "string" ? undefined : decision?.category ?? (wine ? "wine" : undefined);
  const category = categoryName ? { category: categoryName, source } : undefined;
  const refuse = (drop: UkPriceDropReason): Extract<PriceAdmission, { kind: "refused" }> => ({
    kind: "refused", drop, category: category ?? (fullPint ? { category: "beer", source: "pint" } : undefined),
  });
  const lineEnd = line.start + line.text.length;
  const leading = selection.leadingDescription
    ? text.slice(selection.leadingDescription.start, selection.leadingDescription.end).replaceAll("\n", " ")
    : "";
  const continuation = text.slice(lineEnd, selection.continuationEnd ?? lineEnd).replaceAll("\n", " ");
  const claim = `${leading}${before} ${raw.verbatim}${tail}${continuation}`;
  const claimPriceAt = leading.length + before.length + 1;
  if (namesGoods(claim)) return refuse("no-drink-word-nearby");
  // The full owned claim and the unresolved same-line context are separate.
  // A sibling's fractional offer cannot replace the owned claim check.
  function hasOffer(): boolean {
    const priceAtInLine = raw.at - line.start;
    const blockingFraction = FRACTIONAL_PRICE_DISCOUNT.test(line.text)
      && fractionalOfferOwners(line.text, line.text, 0).some((owner) => !owner || owner.priceAt === priceAtInLine);
    const unassignedStart = priceAtInLine + raw.verbatim.length + tail.length;
    const unassignedOffer = unassigned.length > 0 && priceHasOffer(line.text, priceAtInLine, unassigned, unassignedStart);
    return Boolean(selection.scopedOffer || priceHasOffer(claim, claimPriceAt, claim, 0) || blockingFraction || unassignedOffer);
  }
  if (hasOffer()) return refuse("offer-not-a-menu-price");
  if (fraction.disputed) return refuse("fractional-measure-not-a-pint");
  if (decision === "item-name-ambiguous") return refuse(decision);
  if (typeof decision !== "string" && decision?.fromMixer) return refuse("mixer-serve-not-one-drink");
  const allowUkContext = decision !== "no-category-word-nearby" && (Boolean(wine) || !(
    (selection.startsItem && !hasPrintedName(label))
    || (stated && (!decision || decision.category === "wine"))
  ));
  if (hasFoodWords(claim) || hasFoodWords(unassigned)) {
    return { ...refuse("food-word-nearby"), allowUkContext };
  }
  if (malformedPair) return refuse("no-category-word-nearby");
  if (!allowUkContext) return { kind: "unclassified", allowUkContext: false };

  if (category?.category === "coffee" && coffeePriceExcludedAt(text, raw.at, drinkLabel)) {
    return refuse("no-category-word-nearby");
  }
  const bandCategory = category?.category ?? (fullPint ? "beer" : undefined);
  const drop = bandCategory ? categoryPriceDropReason(bandCategory, raw.priceGbp) : null;
  if (drop) return refuse(drop);
  return category ? { kind: "accepted", category } : { kind: "unclassified", allowUkContext: true };
}

function inheritedServingLabel(
  text: string,
  selected: SelectedPrice,
  before: string,
  previous: PrintedPriceEvidence | undefined,
): string | null {
  if (!previous || selected.startsItem
    || previous.fraction.fractional || hasPrintedName(before) || FRACTIONAL_BEER_MEASURE.test(before)) return null;
  const serving = before.replace(/^[/|\s\u2013\u2014-]+/, "").trim();
  const trailing = LEADING_SERVING.exec(selected.tail.replace(/^[/|\s]+/, ""))?.[0] ?? "";
  if (!SERVING_SIZE.test(serving) && !SERVING_SIZE.test(trailing)) return null;

  const between = text.slice(previous.raw.at + previous.raw.verbatim.length, selected.raw.at);
  if (/[.;!?]/.test(between)) return null;
  const glass = statedWineMeasure(serving);
  const previousGlass = previous.statedWine?.servingSize;
  const sameWine = previous.wine && glass;
  if (previous.admission.kind === "refused" && !(sameWine && previous.admission.drop === "outside-category-band")) {
    return null;
  }
  if (PRICE_ITEM_SEPARATOR.test(between)
    && !(glass && GLASS_ML.has(glass.servingSize) && previousGlass && GLASS_ML.has(previousGlass))) return null;
  const name = previous.statedWine?.drinkLabel ?? cleanListedDrinkName(previous.label);
  return name ? (serving ? name + " " + serving : name) : null;
}

function buildPriceEvidence(
  text: string,
  line: PrintedMenuLine,
  selected: SelectedPrice,
  nameStart: number,
  inWineSection: boolean,
  previous?: PrintedPriceEvidence,
  pair?: PairedServing,
  malformedPair = false,
): PrintedPriceEvidence {
  const { raw, tail, fraction } = selected;
  const end = raw.at + raw.verbatim.length;
  const lineEnd = line.start + line.text.length;
  const local = text.slice(nameStart, raw.at).replace(LEADING_PRICE_ITEM_SEPARATORS, "").replaceAll("\n", " ").trim();
  const inherited = pair ? null : inheritedServingLabel(text, selected, local, previous);
  const before = pair ? pair.label + " " + pair.size : inherited ?? local;
  const startsScopedLine = selected.startsTitle && line.start > 0 && text[line.start - 1] !== "\n";
  const printed = nameStart < line.start || startsScopedLine
    ? { own: before, preceding: [] }
    : printedItemName(text, raw.at) ?? (selected.startsTitle ? { own: before, preceding: [] } : undefined);
  const identity = priceItemIdentity(before, tail.trim(), printed);
  const label = identity.drinkLabel ?? before;
  const measure = pair
    ? { drinkLabel: pair.label, servingSize: pair.size }
    : statedWineMeasure(before);
  const stated = measure?.drinkLabel ? measure : null;
  const wine = stated && (inWineSection || categoryFor(stated.drinkLabel, stated.drinkLabel.length) === "wine")
    ? stated : null;
  const hasItemName = hasPrintedName(label);
  const directCategory = identity.decision && typeof identity.decision !== "string" && !identity.decision.fromMixer;
  function isFullPint(): boolean {
    return !fraction.fractional && !fraction.disputed && namesFullPint(label, tail)
      && (/\bpints?\b/i.test(`${label} ${tail}`) || Boolean(directCategory && hasItemName));
  }
  const fullPint = isFullPint();
  const admission: PriceAdmission = end > lineEnd
    ? { kind: "refused", drop: "not-verbatim-on-page" }
    : preServingAdmission(
      text, line, selected, before, identity, stated, wine, fullPint, inherited ? "inherited" : "item", malformedPair,
    );
  const descriptionStart = Math.min(end, lineEnd);
  return {
    raw,
    line: { start: line.start, end: lineEnd },
    name: pair?.name ?? (inherited && previous ? previous.name : { start: nameStart, end: raw.at }),
    description: { start: descriptionStart, end: selected.continuationEnd ?? descriptionStart + tail.length },
    leadingDescription: selected.leadingDescription,
    scopedOffer: selected.scopedOffer,
    pair,
    label,
    tail,
    statedWine: stated,
    wine,
    admission,
    fraction,
    fullPint,
    independentDrink: !inherited && admission.kind !== "refused" && typeof identity.decision !== "string"
      && Boolean(fullPint || (directCategory && hasItemName) || wine),
  };
}

/** The printed item and admission record retain the original price offset. */
export function printedPriceLayout(
  { text, structuralBreaks, inlineBreaks, headings, containerBreaks }: PrintedPage,
  options: { wineOrdinals?: ReadonlySet<number>; itemHeadings?: boolean } = {},
): PrintedPriceLayout {
  const rawPrices = findUkPriceCandidates(text);
  const wineOffsets = new Set(rawPrices.filter((_raw, index) => options.wineOrdinals?.has(index)).map(({ at }) => at));
  const prices = new Map<number, PrintedPriceEvidence>();
  const parts: PricedMenuPart[] = [];
  const lines: PrintedMenuLine[] = [];
  const nameLines = new Set<number>();
  const descriptionLines = new Set<number>();
  const blockOfferCues = new Map<number, PrintedSpan>();
  const headingOffers = new Map<number, PrintedSpan>();
  const selectedByLine = new Map<number, SelectedPrice[]>();
  const nameStarts = new Map<number, number>();
  const titleParents = new Map<number, PrintedMenuLine>();
  const headingStack: Array<ScopedHeading & { line: PrintedMenuLine; value: PrintedSpan | undefined }> = [];
  let start = 0;
  let cursor = 0;
  let blockStart = 0;
  let depth = 0;

  function canContinue(line: PrintedMenuLine, prior?: PrintedMenuLine): boolean {
    return !selectedByLine.get(line.start)?.length && !unpricedFractionToken(line)
      && !DESCRIPTION_PREFIX.test(line.text)
      && !blockOfferCues.has(line.start)
      && !(prior && inlineBreaks.has(line.start - 1) && finishesDescription(prior.text, line.text))
      && !isPrintedSectionHeading(line.text) && (hasPrintedName(line.text) || SERVING_SIZE.test(line.text));
  }

  function itemTitle(index: number, first: SelectedPrice): number | undefined {
    const line = lines[index];
    if (!options.itemHeadings || first.tail.trim() || text.slice(first.nameStart, first.raw.at).trim()
      || !line || containerBreaks.has(line.start - 1)) return undefined;
    const title = lines[index - 1];
    if (!title || !headings.has(title.start) || !canContinue(title)) return undefined;
    const parent = titleParents.get(title.start);
    const drinkSection = parent && printedMenuHeading(parent.text)?.kind === "drinks"
      && isPrintedSectionHeading(parent.text);
    const titleCategory = categoryDecisionFromLabel(title.text, undefined);
    const recognisedTitle = titleCategory && typeof titleCategory !== "string" && !titleCategory.fromMixer;
    if (!recognisedTitle && !drinkSection) return undefined;
    // The first named item keeps its explicit section label, as in the
    // document reader. Subsequent items get only their own heading.
    return parent && drinkSection && lines[index - 2]?.start === parent.start ? parent.start : title.start;
  }

  function readBlock(blockEnd: number): void {
    function recordPrefixOffers(firstIndex: number, endIndex: number): void {
      const first = lines[firstIndex];
      const last = lines[endIndex - 1];
      if (firstIndex >= endIndex || !first || !last) return;
      const prefix = text.slice(first.start, last.start + last.text.length).replaceAll("\n", " ");
      if (!OFFER_WORDS.test(prefix)) return;
      const prefixLines = lines.slice(firstIndex, endIndex);
      const cueSpan = (match: RegExpMatchArray): PrintedSpan => {
        const start = first.start + (match.index ?? 0);
        return { start, end: start + match[0].length };
      };
      const fractional = Array.from(prefix.matchAll(new RegExp(FRACTIONAL_PRICE_DISCOUNT.source, "gi")), cueSpan);
      const itemLinks = Array.from(prefix.matchAll(ITEM_DESCRIPTION_LINK), cueSpan);
      for (const match of groupOfferMatches(prefix)) {
        const cue = cueSpan(match);
        if (fractional.some(({ start, end }) => start <= cue.start && cue.end <= end)) continue;
        for (const line of prefixLines) {
          const lineEnd = line.start + line.text.length;
          if (cue.start >= lineEnd || cue.end <= line.start) continue;
          // An attachment clause applies to its own source line, not to a preceding heading.
          if (itemLinks.some(({ start, end }) => start < lineEnd && end > line.start
            && !PRICE_ITEM_SEPARATOR.test(text.slice(Math.min(end, cue.end), Math.max(start, cue.start))))) continue;
          blockOfferCues.set(line.start, cue);
        }
      }
    }

    let prefixStart = blockStart;
    for (let index = blockStart; index < blockEnd; index += 1) {
      const line = lines[index];
      if (!line || !selectedByLine.get(line.start)?.length) continue;
      recordPrefixOffers(prefixStart, index);
      prefixStart = index + 1;
    }

    const titleStarts = new Map<number, number>();
    function recordTitles(): void {
      for (let index = blockStart; index < blockEnd; index += 1) {
        const line = lines[index];
        if (!line) break;
        const selected = selectedByLine.get(line.start) ?? [];
        const first = selected[0];
        if (!first) continue;
        const titleStart = selected.length === 1 ? itemTitle(index, first) : undefined;
        if (titleStart !== undefined) {
          titleStarts.set(line.start, titleStart);
          continue;
        }
        const before = text.slice(first.nameStart, first.raw.at);
        const previousLine = lines[index - 1];
        if (index > blockStart && previousLine && canContinue(previousLine, lines[index - 2])
          && !hasPrintedName(before) && !hasPrintedName(first.tail)) {
          const explicitWrap = inlineBreaks.has(line.start - 1);
          let firstLine = index - 1;
          let fragment = previousLine;
          while (firstLine > blockStart) {
            if (!(explicitWrap && inlineBreaks.has(fragment.start - 1)) && hasPrintedName(fragment.text)) break;
            const earlier = lines[firstLine - 1];
            // An earlier section heading stays separate from the nearest name.
            if (!earlier || printedMenuHeading(earlier.text) || !canContinue(earlier, lines[firstLine - 2])) break;
            fragment = earlier;
            firstLine -= 1;
          }
          if (hasPrintedName(text.slice(fragment.start, line.start))) {
            nameStarts.set(line.start, fragment.start);
            for (const nameLine of lines.slice(firstLine, index)) nameLines.add(nameLine.start);
          }
        }
      }
    }
    recordTitles();

    function continuationEnd(index: number, line: PrintedMenuLine, price: SelectedPrice): number | undefined {
      const lineEnd = line.start + line.text.length;
      const priceEnd = price.raw.at + price.raw.verbatim.length;
      if (priceEnd + price.tail.length !== lineEnd) return undefined;
      let end = lineEnd;
      for (let nextIndex = index + 1; nextIndex < blockEnd && inlineBreaks.has(end); nextIndex += 1) {
        const next = lines[nextIndex];
        if (!next || selectedByLine.get(next.start)?.length || nameLines.has(next.start)
          || blockOfferCues.has(next.start)) break;
        const nextEnd = next.start + next.text.length;
        const after = nextIndex + 1 < blockEnd && inlineBreaks.has(nextEnd) ? lines[nextIndex + 1] : undefined;
        if (unpricedFractionToken(next)) {
          if (!after || selectedByLine.get(after.start)?.length
            || nameLines.has(after.start) || !joinsFractionalDiscount(next.text, after.text)) break;
        }
        const sectionHeading = isPrintedSectionHeading(next.text);
        if (sectionHeading || printedMenuHeading(next.text)) {
          const prefix = text.slice(priceEnd, end).replaceAll("\n", " ").trimEnd();
          if (!finishesDescription(prefix, next.text) && (sectionHeading
            || (!hasFoodWords(next.text) && !OFFER_WORDS.test(next.text)))) break;
        }
        descriptionLines.add(next.start);
        end = nextEnd;
      }
      return end > lineEnd ? end : undefined;
    }

    function leadingDescription(index: number, nameStart: number): PrintedSpan | undefined {
      let itemIndex = index;
      while (itemIndex > blockStart && (lines[itemIndex]?.start ?? Infinity) > nameStart) itemIndex -= 1;
      const item = lines[itemIndex];
      if (!item) return undefined;
      let firstIndex = itemIndex;
      let start = item.start;
      while (firstIndex > blockStart && inlineBreaks.has(start - 1)) {
        const prior = lines[firstIndex - 1];
        if (!prior || selectedByLine.get(prior.start)?.length || nameLines.has(prior.start)
          || descriptionLines.has(prior.start) || blockOfferCues.has(prior.start)) break;
        const opener = firstIndex - 2 >= blockStart && inlineBreaks.has(prior.start - 1)
          ? lines[firstIndex - 2] : undefined;
        if (unpricedFractionToken(prior)) {
          const after = firstIndex < itemIndex && lines[firstIndex];
          if (!after || !joinsFractionalDiscount(prior.text, after.text)) break;
        }
        if (printedMenuHeading(prior.text) || isPrintedSectionHeading(prior.text)) {
          if (!DESCRIPTION_PREFIX.test(prior.text)
            && !(opener && finishesDescription(opener.text, prior.text))) break;
        }
        firstIndex -= 1;
        start = prior.start;
      }
      if (firstIndex === itemIndex) return undefined;
      const note = text.slice(start, item.start).replaceAll("\n", " ");
      if (!namesGoods(note) && !hasFoodWords(note) && !priceHasOffer(note, 0, note, 0)) return undefined;
      for (const line of lines.slice(firstIndex, itemIndex)) descriptionLines.add(line.start);
      return { start, end: item.start };
    }

    function recordPrices(): void {
      let blockOffer: PrintedSpan | undefined;
      for (let index = blockStart; index < blockEnd; index += 1) {
        const line = lines[index];
        if (!line) break;
        if (isRegularDrinksHeading(line.text)) blockOffer = undefined;
        blockOffer = blockOfferCues.get(line.start) ?? blockOffer;
        const selected = selectedByLine.get(line.start) ?? [];
        const first = selected[0];
        if (!first) continue;
        const nameStart = titleStarts.get(line.start) ?? nameStarts.get(line.start) ?? first.nameStart;
        const projectedStart = Math.min(line.start, nameStart);
        const projected = text.slice(projectedStart, line.start + line.text.length).replaceAll("\n", " ");
        const paired = new Map<number, PairedServing>();
        const malformedPairs = new Set<number>();
        const selectedByOffset = new Map(selected.map((price) => [price.raw.at, price]));
        const offsets = selected.map((price) => price.raw.at - projectedStart);
        const recordPairs = (): void => {
          for (const group of printedMeasurePairs(projected, offsets)) {
            const firstPrice = group.prices[0];
            if (!group.valid) {
              for (const at of group.prices) malformedPairs.add(projectedStart + at);
              continue;
            }
            if (firstPrice === undefined) continue;
            const firstAt = projectedStart + firstPrice;
            const owner = selectedByOffset.get(firstAt);
            if (!owner) continue;
            const from = owner === first ? nameStart : owner.nameStart;
            const to = projectedStart + group.start;
            const label = text.slice(from, to).replace(LEADING_PRICE_ITEM_SEPARATORS, "").replaceAll("\n", " ").trim();
            if (!hasPrintedName(label)) {
              for (const at of group.prices) malformedPairs.add(projectedStart + at);
              continue;
            }
            for (const [position, price] of group.prices.entries()) {
              const measure = group.measures[position];
              if (!measure) continue;
              paired.set(projectedStart + price, {
                label,
                size: measure.size,
                name: { start: from, end: to },
                measure: { start: projectedStart + measure.span.start, end: projectedStart + measure.span.end },
              });
            }
          }
        };
        recordPairs();
        let previous: PrintedPriceEvidence | undefined;
        for (const [position, price] of selected.entries()) {
          const firstPrice = position === 0;
          const finalPrice = position === selected.length - 1;
          const owned = {
            ...price,
            scopedOffer: blockOffer ?? headingOffers.get(line.start),
            leadingDescription: firstPrice ? leadingDescription(index, nameStart) : undefined,
            continuationEnd: finalPrice ? continuationEnd(index, line, price) : undefined,
          };
          const evidence = buildPriceEvidence(
            text, line, owned, firstPrice ? nameStart : price.nameStart,
            wineOffsets.has(price.raw.at), previous, paired.get(price.raw.at), malformedPairs.has(price.raw.at),
          );
          prices.set(price.raw.at, evidence);
          previous = evidence;
        }
      }
    }
    recordPrices();

    function edge(line: PrintedMenuLine | undefined, side: "first" | "last"): PrintedPriceEvidence | undefined {
      if (!line) return undefined;
      const selected = selectedByLine.get(line.start);
      const price = side === "first" ? selected?.[0] : selected?.at(-1);
      return price && prices.get(price.raw.at);
    }

    function applyFractionQualifiers(): void {
      for (let index = blockStart; index < blockEnd;) {
        const line = lines[index];
        const qualifier = line && !descriptionLines.has(line.start) && unpricedFraction(line);
        if (!qualifier) {
          index += 1;
          continue;
        }
        const earlier = edge(index > blockStart ? lines[index - 1] : undefined, "last");
        index += 1;
        let following = lines[index];
        while (index < blockEnd && following && unpricedFraction(following)) {
          index += 1;
          following = lines[index];
        }

        let after = index < blockEnd ? lines[index] : undefined;
        if (after && !selectedByLine.get(after.start)?.length) {
          const nameStart = after.start;
          let priceLine = index + 1;
          let following = lines[priceLine];
          while (priceLine < blockEnd && following && canContinue(following)) {
            priceLine += 1;
            following = lines[priceLine];
          }
          if (priceLine < blockEnd && following && nameStarts.get(following.start) === nameStart) after = following;
        }
        const later = edge(after, "first");
        if (earlier && !(earlier.fullPint && earlier.independentDrink && later?.independentDrink)) {
          earlier.qualifier = qualifier;
        }
        if (later && !(later.fullPint && later.independentDrink && earlier?.independentDrink)) {
          later.qualifier = qualifier;
        }
      }
    }
    applyFractionQualifiers();
  }

  function readLines(): void {
    // A scope can end in the middle of a line. Split the layout at its
    // recorded separator without replacing the space in the original text.
    const lineEnds = new Set([text.length]);
    for (const match of text.matchAll(/\n/g)) lineEnds.add(match.index);
    for (const boundary of containerBreaks.keys()) {
      if (boundary >= 0) lineEnds.add(boundary);
    }
    const orderedLineEnds = [...lineEnds].sort((left, right) => left - right);
    for (const [lineIndex, end] of orderedLineEnds.entries()) {
      const line = { start, text: text.slice(start, end) };
      lines.push(line);
      const container = containerBreaks.get(start - 1);
      if (container) {
        trimHeadings(headingStack, container.sharedDepth);
        depth = container.nextDepth;
      }
      const level = headings.get(start);
      if (level !== undefined) {
        trimHeadings(headingStack, depth, level);
        const parent = headingStack.findLast((entry) => entry.level < level);
        if (parent && options.itemHeadings) titleParents.set(start, parent.line);
        let headingEnd = end;
        for (let nextIndex = lineIndex + 1; inlineBreaks.has(headingEnd); nextIndex += 1) {
          const nextEnd = orderedLineEnds[nextIndex];
          if (nextEnd === undefined) break;
          headingEnd = nextEnd;
        }
        const headingText = text.slice(start, headingEnd).replaceAll("\n", " ");
        const offer = explicitHeadingOffer(headingText);
        const offerAt = offer?.index ?? 0;
        const value = offer ? { start: start + offerAt, end: start + offerAt + offer[0].length } : undefined;
        headingStack.push({ line, level, depth, value });
      }
      const first = cursor;
      while ((rawPrices[cursor]?.at ?? Infinity) < end) cursor += 1;
      if (first < cursor) {
        const offer = scopedHeadingValue(headingStack);
        if (offer) headingOffers.set(start, offer);
      }
      selectedByLine.set(start, selectLinePrices(line, rawPrices.slice(first, cursor)));
      start = end + 1;
      if (!structuralBreaks.has(end) && !containerBreaks.has(end)) continue;
      readBlock(lines.length);
      blockStart = lines.length;
    }
    readBlock(lines.length);
  }
  readLines();

  function projectParts(): void {
    const menuHeadings: Array<ScopedHeading & { value: "drinks" | "food" | undefined }> = [];
    let menuDepth = 0;
    for (const line of lines) {
      const container = containerBreaks.get(line.start - 1);
      if (container) {
        trimHeadings(menuHeadings, container.sharedDepth);
        menuDepth = container.nextDepth;
      }
      if (nameLines.has(line.start) || descriptionLines.has(line.start) || blockOfferCues.has(line.start)) continue;
      const level = headings.get(line.start);
      const heading = printedMenuHeading(line.text);
      if (level !== undefined || heading) {
        const headingLevel = level ?? 7;
        trimHeadings(menuHeadings, menuDepth, headingLevel);
        menuHeadings.push({ value: heading?.kind, depth: menuDepth, level: headingLevel });
      }
      const menuSection = scopedHeadingValue(menuHeadings) ?? null;
      const selected = selectedByLine.get(line.start) ?? [];
      let partStart = nameStarts.get(line.start) ?? line.start;
      let priceOffsets: number[] = [];
      for (const price of selected) {
        if (priceOffsets.length > 0 && price.startsItem) {
          parts.push({ start: partStart, text: text.slice(partStart, price.nameStart).replaceAll("\n", " "), priceOffsets, menuSection });
          partStart = price.nameStart;
          priceOffsets = [];
        }
        priceOffsets.push(price.raw.at);
      }
      parts.push({
        start: partStart,
        text: text.slice(partStart, line.start + line.text.length).replaceAll("\n", " "),
        priceOffsets,
        menuSection,
      });
    }
  }
  projectParts();
  return { lines: parts, prices };
}

function beerMeasureDrop(
  text: string, at: number, verbatim: string, priceGbp: number, fractional: boolean, drinkLabel?: string,
  wrappedDispute = false,
): UkPriceDropReason | null {
  const before = drinkLabel ?? text.slice(Math.max(0, at - 30), at);
  const after = text.slice(at + verbatim.length, at + verbatim.length + 12);
  if (isHalfMeasure(before) || isFirstOfAMeasurePair(after) || isHalfOfABarePair(after, priceGbp)) {
    return "half-measure-not-a-pint";
  }
  if (fractional || wrappedDispute || FRACTIONAL_BEER_MEASURE.test(drinkLabel ?? "")) {
    return "fractional-measure-not-a-pint";
  }
  return isBottledMeasure(before) || inBottledSection(text, at) ? "bottled-measure-not-a-pint" : null;
}

type KeylessPriceDecision = { kept?: UkPriceCandidate; drop?: UkPriceDropReason };

function decideKeylessPrice(text: string, evidence: PrintedPriceEvidence, offerText = text): KeylessPriceDecision {
  const { admission, raw, label, wine, fraction, qualifier } = evidence;
  const contextStart = Math.max(0, raw.at - PRICE_CONTEXT_CHARS);
  const contextEnd = raw.at + raw.verbatim.length + PRICE_CONTEXT_CHARS;
  const context = text.slice(contextStart, contextEnd);
  if (priceHasOffer(text, raw.at, offerText.slice(contextStart, contextEnd), contextStart)) {
    return { drop: "offer-not-a-menu-price" };
  }
  if (admission.kind === "refused") {
    if (admission.drop !== "food-word-nearby") return { drop: admission.drop };
    if (!admission.allowUkContext) return { drop: "no-category-word-nearby" };
  }
  // UK checks for a drink category and its price band before reporting food.
  const ownCategory = "category" in admission && admission.category?.source !== "pint"
    ? admission.category?.category : undefined;
  const fallback = !ownCategory && "allowUkContext" in admission && admission.allowUkContext
    ? categoryDecisionFor(context, raw.at - contextStart) : null;
  if (fallback?.fromMixer) return { drop: "mixer-serve-not-one-drink" };
  const category = ownCategory ?? fallback?.category;
  if (!category) return { drop: "no-category-word-nearby" };
  if (admission.kind !== "accepted") {
    if (category === "coffee" && coffeePriceExcludedAt(text, raw.at, label)) {
      return { drop: "no-category-word-nearby" };
    }
    const bandDrop = categoryPriceDropReason(category, raw.priceGbp);
    if (bandDrop) return { drop: bandDrop };
  }
  if (admission.kind === "refused") return { drop: admission.drop };
  if (category === "beer") {
    const measureDrop = beerMeasureDrop(
      text, raw.at, raw.verbatim, raw.priceGbp, fraction.fractional, label, Boolean(qualifier),
    );
    if (measureDrop) return { drop: measureDrop };
  }
  return {
    kept: {
      priceGbp: raw.priceGbp,
      category,
      verbatim: raw.verbatim,
      context,
      drinkLabel: category === "wine" ? wine?.drinkLabel ?? label : label || undefined,
      ...(category === "wine" && wine ? { servingSize: wine.servingSize } : {}),
    },
  };
}

export function decideKeylessUkPriceCandidate(
  text: string,
  raw: UkPriceRawCandidate,
  inWineSection = false,
): KeylessPriceDecision {
  if (!text.startsWith(raw.verbatim, raw.at)) return { drop: "not-verbatim-on-page" };
  const lineStart = text.lastIndexOf("\n", raw.at - 1) + 1;
  const lineEnd = text.indexOf("\n", raw.at);
  const line = { start: lineStart, text: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd) };
  const candidates = findUkPriceCandidates(line.text).map((candidate) => ({ ...candidate, at: lineStart + candidate.at }));
  let previous: PrintedPriceEvidence | undefined;
  for (const selected of selectLinePrices(line, candidates)) {
    if (selected.raw.at > raw.at) break;
    const found = selected.raw.at === raw.at;
    const evidence = buildPriceEvidence(
      text, line, found ? { ...selected, raw } : selected, selected.nameStart, inWineSection, previous,
    );
    if (found) return decideKeylessPrice(text, evidence);
    previous = evidence;
  }
  return { drop: "not-verbatim-on-page" };
}

export function readKeylessUkPriceDecisions(
  html: string,
  sourceFormat: UkPriceSourceFormat = "text",
): Map<number, KeylessPriceDecision> {
  const page = printedPageText(html, sourceFormat);
  const layout = printedPriceLayout(page, { wineOrdinals: wineSectionPriceOrdinals(html), itemHeadings: true });
  // Each owned continuation has already reached its price's local admission.
  // Keep its words out of the broad offer window for other prices.
  const offerParts: string[] = [];
  let from = 0;
  function maskNote(start: number, end: number): void {
    offerParts.push(page.text.slice(from, start), page.text.slice(start, end).replace(/[^\n]/g, " "));
    from = end;
  }
  for (const { line, description, leadingDescription } of layout.prices.values()) {
    if (leadingDescription) maskNote(leadingDescription.start, leadingDescription.end);
    if (description.end > line.end) maskNote(line.end, description.end);
  }
  const offerText = offerParts.join("") + page.text.slice(from);
  return new Map([...layout.prices].map(([at, evidence]) => [at, decideKeylessPrice(page.text, evidence, offerText)]));
}

export function readVenueDrinkPrices(
  html: string,
  sourceFormat: UkPriceSourceFormat = "text",
): UkPriceReading {
  const decisions = readKeylessUkPriceDecisions(html, sourceFormat);
  const kept: UkPriceCandidate[] = [];
  const drops: UkPriceDropReason[] = [];
  if (decisions.size === 0) return { kept, drops: ["no-price-on-page"] };

  for (const outcome of decisions.values()) {
    if (outcome.kept) kept.push(outcome.kept);
    else if (outcome.drop) drops.push(outcome.drop);
  }

  return { kept, drops };
}

/**
 * Whether the page is a drinks LIST rather than a page that happens to mention
 * a price.
 *
 * TWO TESTS, and the second is the one that was missing. A list states many
 * priced lines, so a page under the floor is a promo shelf and not a menu. And a
 * page whose figures are MOSTLY food is a food menu: a pub's lunch card states
 * forty dishes and, somewhere among them, a crab cocktail and a beef and ale
 * pie, which is exactly how "£9.50" for a lunch sandwich became the price of a
 * beer on the first run of this crawler. Where the food figures outnumber the
 * drink ones the page is a food menu and nothing on it is taken.
 */
export function pageStatesADrinksList(reading: UkPriceReading): boolean {
  if (reading.kept.length < MIN_PRICED_LINES_FOR_LIST) return false;
  const foodLines = reading.drops.filter((reason) => reason === "food-word-nearby").length;
  return reading.kept.length > foodLines;
}

/** The slug a pub's own name would wear in a URL. */
export function pubNameSlug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- which branch a page speaks for ----------------------------------------
//
// A HOST WITH ONE MATCHED PUB IS NOT A HOST WITH ONE PUB. The snapshot states a
// website only for the pubs OSM tagged with one, so a chain whose other
// branches carry no website tag looks, from the snapshot, like one pub's own
// site. The crawl then counted one pub on the host (`pubsOnHost: 1`) and gave
// that pub every page it read there. Found on 1 Nov 2026: The Botanist Gas
// Street Basin (Birmingham) carried £4.95 read off the chain's Barnsley page
// (`/locations/barnsley/whats-on`), and Simmons in Camden carried prices read
// off the Shoreditch page (`/venues/shoreditch-cocktail-bar/`).
//
// So a page whose path NAMES a branch, in a segment after a word such as
// `locations`, `venues` or `pubs`, speaks for that branch alone, whatever the
// pub count says. It is this pub's page when one of those segments shares a
// word with what the pub states about itself: its name, its locality, its
// address or the path of its own stated website. A page that names no branch
// is left to the pub-count rule below.
//
// GETTING THIS WRONG IN ONE DIRECTION ONLY. A word this rule cannot read as a
// branch makes the page "names no branch", which keeps today's answer. Only a
// page that plainly names a place, and a place the pub never states, is
// refused.

/** Path segments after which a chain's URL names one of its branches. */
const BRANCH_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "location", "locations", "venue", "venues", "pub", "pubs", "branch", "branches",
  "bars", "restaurants", "our-pubs", "our-venues", "our-bars", "our-locations", "find-us",
]);

/**
 * Words in a branch path that say nothing about WHICH branch: page words, menu
 * words, pub words and street words. A singular `bar` or `restaurant` is not a
 * branch segment above, because a pub's own site files its drinks under them.
 */
const NOT_A_BRANCH_WORD: ReadonlySet<string> = new Set([
  "the", "and", "our", "for", "with", "pub", "pubs", "bar", "bars", "inn", "arms", "tavern",
  "hotel", "house", "club", "kitchen", "restaurant", "restaurants", "cafe", "cocktail",
  "cocktails", "menu", "menus", "drink", "drinks", "food", "whats", "what", "offers", "offer",
  "deals", "events", "event", "page", "home", "index", "html", "htm", "php", "pdf", "wine",
  "wines", "beer", "beers", "ale", "ales", "cask", "craft", "gin", "spirits", "list", "prices",
  "price", "tap", "taps", "info", "about", "book", "booking", "bookings", "table", "gallery",
  "contact", "happy", "hour", "hours", "special", "specials", "latest", "news", "street", "road",
  "lane", "avenue", "square", "place", "high", "upper", "lower",
]);

/** Lower case, accents dropped, so "Café" and "cafe" are one word. */
function foldText(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/** The words of a text, read with its apostrophes both dropped and split, so "Queen's" is "queens" and "queen". */
function textWords(text: string): string[] {
  const folded = foldText(text);
  return [folded.replace(/['’`]/g, ""), folded]
    .flatMap((spelling) => spelling.split(/[^a-z]+/))
    .filter((word) => word.length >= 3);
}

/** A text with everything but its letters gone: "court-house" and "The Courthouse" meet at "courthouse". */
function compactText(text: string): string {
  return foldText(text).replace(/[^a-z]/g, "");
}

/** The path segments after the first branch segment, or null when the path has none. */
function branchSegments(pageUrl: string): string[] | null {
  let segments: string[];
  try {
    segments = new URL(pageUrl).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return foldText(decodeURIComponent(segment));
        } catch {
          return foldText(segment);
        }
      });
  } catch {
    return null;
  }
  const at = segments.findIndex((segment) => BRANCH_PATH_SEGMENTS.has(segment));
  return at === -1 ? null : segments.slice(at + 1);
}

/** What a pub states about itself that a branch URL could name it by. */
export type BranchIdentity = {
  name?: string | null;
  locality?: string | null;
  address?: string | null;
  /** The pub's own stated website (OSM `website`), whose path may name its branch. */
  website?: string | null;
};

/**
 * What a branch URL could name this pub by: each word it states about itself,
 * and each whole spelling of its name or its website's path, letters only.
 */
function branchIdentity(pub: BranchIdentity): { words: Set<string>; names: Set<string> } {
  const words = new Set<string>();
  const names = new Set<string>();
  const addWords = (text: string | null | undefined) => {
    if (typeof text !== "string") return;
    for (const word of textWords(text)) words.add(word);
  };
  const addName = (text: string) => {
    addWords(text);
    for (const spelling of [text, text.replace(/^\s*(the|ye olde|ye)\s+/i, "")]) {
      const compact = compactText(spelling);
      if (compact.length >= 4) names.add(compact);
    }
  };
  if (typeof pub.name === "string") addName(pub.name);
  addWords(pub.locality);
  addWords(pub.address);
  if (typeof pub.website === "string" && pub.website.trim().length > 0) {
    const website = pub.website.includes("//") ? pub.website.trim() : `https://${pub.website.trim()}`;
    try {
      for (const segment of new URL(website).pathname.split("/").filter(Boolean)) {
        let decoded = segment;
        try {
          decoded = decodeURIComponent(segment);
        } catch {
          // A malformed escape is read as written.
        }
        addName(decoded);
      }
    } catch {
      // A website that is not a URL states no branch.
    }
  }
  return { words, names };
}

/**
 * Whether a page's own URL names a branch that is NOT this pub. See the section
 * comment above: a page that names no branch, or names this one, answers false.
 */
export function pageNamesAnotherBranch(pageUrl: string, pub: BranchIdentity): boolean {
  const segments = branchSegments(pageUrl);
  if (!segments) return false;
  const named = segments.flatMap((segment) => textWords(segment)).filter((word) => !NOT_A_BRANCH_WORD.has(word));
  if (named.length === 0) return false;
  const own = branchIdentity(pub);
  if (named.some((word) => own.words.has(word))) return false;
  // "court-house" is The Courthouse and "taps" is The Taps, though no word of
  // either path is a branch word on its own.
  return !segments.some((segment) => own.names.has(compactText(segment)));
}

/**
 * Whether a page may speak for one named pub.
 *
 * A page that names ANOTHER branch in its path never may (`pageNamesAnotherBranch`).
 * Past that, a host serving one pub is that pub's own site, and every page on it
 * is about that pub. A host serving an estate is not: its homepage price is an
 * estate banner, and attributing it to each pub on the host turns one figure
 * into hundreds of wrong ones. So an estate page has to NAME the pub in its own
 * URL before its price may be that pub's.
 */
export function pageMayPriceThisPub(
  pageUrl: string,
  pub: BranchIdentity,
  pubsOnHost: number,
): boolean {
  if (pageNamesAnotherBranch(pageUrl, pub)) return false;
  if (pubsOnHost <= 1) return true;
  const name = typeof pub.name === "string" ? pubNameSlug(pub.name) : "";
  if (name.length < 4) return false;
  let path: string;
  try {
    path = pubNameSlug(decodeURIComponent(new URL(pageUrl).pathname));
  } catch {
    return false;
  }
  // The distinctive half of a pub's name is what a slug carries: "the-crown"
  // appears in a path as "crown". A leading article is dropped before matching
  // so "The Ship" is not held to a path that says "ship".
  const distinctive = name.replace(/^(the|ye-olde|ye)-/, "");
  return distinctive.length >= 4 && path.includes(distinctive);
}

/**
 * Keep distinct names and explicit servings separate, so a cheaper small
 * glass cannot erase the same wine's larger glass quote.
 */
export function cheapestPerCategory(reading: UkPriceReading): ReadonlyArray<UkPriceCategoryRow> {
  const low = new Map<string, UkPriceCategoryRow>();
  for (const row of reading.kept) {
    const drinkLabel = row.drinkLabel;
    const key = siteHarvestPriceKey(row.category, drinkLabel, row.servingSize);
    const seen = low.get(key);
    if (!seen || row.priceGbp < seen.priceGbp) {
      low.set(key, {
        category: row.category,
        priceGbp: row.priceGbp,
        ...(drinkLabel ? { drinkLabel } : {}),
        ...(row.servingSize ? { servingSize: row.servingSize } : {}),
      });
    }
  }
  return [...low.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      (a.drinkLabel ?? "").localeCompare(b.drinkLabel ?? ""),
  );
}

// --- page discovery -------------------------------------------------------
//
// A chain source names its one page. A pub site does not, so the crawler has to
// decide which of a site's own links might carry a drinks list. It decides from
// the LINK, never from the page behind it, because opening a page to find out
// whether it was worth opening is the crawl this budget exists to prevent.

/** Path or link words that name a drinks list. */
const MENU_LINK_WORDS =
  /(drinks?|menus?|bar|beer|wine|cocktail|tap[- ]?list|whats[- ]?on[- ]?tap|on[- ]?tap|cellar|price[- ]?list|tariff)/i;

/** Path words that mean the link is a page nobody prices a pint on. */
const MENU_LINK_EXCLUSIONS =
  /(privacy|cookie|terms|careers|jobs|vacanc|gift[- ]?card|voucher|contact|accessib|sitemap|login|account|basket|checkout|book(ing)?[- ]?a[- ]?table|wedding|funeral|christening|conference|newsletter|blog|news\/|\/tag\/|\/author\/|feed|\/shop\/|\/store\/|product[- ]?page|\/products?\/|add[- ]to[- ]cart|lunch|dinner|breakfast|brunch|sunday[- ]?roast|christmas|kids|festive|sample[- ]?menu)/i;

/** File endings a crawler may open. A drinks list is often a PDF. */
const READABLE_ENDINGS = /(\.pdf|\.html?|\/)$/i;

export function isLikelyMenuUrl(candidate: string, siteOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate, siteOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  let origin: URL;
  try {
    origin = new URL(siteOrigin);
  } catch {
    return false;
  }
  // SAME SITE ONLY. A pub's own site is first-party by definition; the third
  // party it links to is a source in its own right and has its own permission
  // question, which this crawl has not asked.
  const host = url.hostname.replace(/^www\./, "");
  const known = origin.hostname.replace(/^www\./, "");
  if (host !== known && !host.endsWith(`.${known}`)) return false;

  const path = `${url.pathname}${url.search}`;
  if (MENU_LINK_EXCLUSIONS.test(path)) return false;
  if (!MENU_LINK_WORDS.test(path)) return false;
  if (!READABLE_ENDINGS.test(url.pathname) && /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return false;
  return true;
}

/**
 * The links on a page that look like a drinks list, deduplicated and in the
 * order the page states them, capped so one navigation-heavy site cannot spend
 * a whole host budget on itself.
 */
export function menuLinkCandidates(html: string, siteOrigin: string, max = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi)) {
    const raw = (match[1] ?? "").trim();
    if (raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;
    if (!isLikelyMenuUrl(raw, siteOrigin)) continue;
    let resolved: string;
    try {
      resolved = new URL(raw, siteOrigin).toString();
    } catch {
      continue;
    }
    const key = resolved.replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

/** Every `<loc>` a sitemap or sitemap index states. */
export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => (match[1] ?? "").trim());
}

/**
 * Whether a rendered page had not finished assembling itself when it was read.
 *
 * AN UNFINISHED RENDER IS A FACT ABOUT US, not about the pub. A browser-built
 * menu read too early carries no menu, which is a different answer from a page
 * that finished and states no price, and only the first is worth asking again.
 *
 * TWO TELLS, because one of them is not enough. The floor catches a bare shell,
 * and it sits well under a real menu page (a Greene King one runs to about eight
 * thousand characters) and well over a shell. But a shell can also be chatty: a
 * Chef & Brewer menu page stalls at 538 characters of heading, booking copy and
 * the words `Content is loading...`, which clears the floor and states nothing.
 * A page that SAYS it is still loading is taken at its word.
 *
 * Getting this wrong in either direction costs one request and never a wrong
 * price: the answer only decides whether to ask again, never what a figure means.
 */
export const EMPTY_RENDER_MAX_CHARS = 400;

/** What a page that has not finished assembling itself says about itself. */
const STILL_LOADING_MARKERS = ["content is loading", "loading..."] as const;

export function renderLooksEmpty(markdown: string): boolean {
  const text = pageText(markdown);
  if (text.length < EMPTY_RENDER_MAX_CHARS) return true;
  const lower = text.toLowerCase();
  return STILL_LOADING_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * What a run may spend on one host. A pub site is a handful of pages; a chain
 * estate behind one host is thousands, and a crawler with no per-host ceiling
 * would spend a whole national budget inside the first one it opened.
 */
export const DEFAULT_PAGES_PER_HOST = 6;

/** The polite gap between two requests to the same host, when it asks for none. */
export const DEFAULT_HOST_DELAY_MS = 1_500;
