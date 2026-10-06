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

import { COFFEE_HARVEST_WORD_PATTERN, coffeePriceLabelExcluded } from "@/lib/coffeePricePilot";
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
      /\b(cocktail|martini|negroni|margarita|mojito|daiquiri|old fashioned|aperol spritz|spritz|bloody mary|cosmopolitan|pornstar|espresso martini|highball|sour)\b/i,
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
      /\b(beer|pilsner|pils|draught|draft|on tap|cask|keg|lager|real ale|ale|cider|stout|guinness|ipa|pale ale|bitter|porter|session|neck oil|madri|camden|amstel|carling|fosters|foster's|peroni|heineken|cruzcampo|kronenbourg|beavertown|estrella|moretti|birra|san miguel|stella|carlsberg|thatchers|aspall|inches|doom bar|landlord|hophead)\b/i,
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
    pattern: /\b(soft drink|coke|coca[- ]cola|pepsi|lemonade|j2o|fruit shoot|juice|squash|still water|sparkling water)\b/i,
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

function isHalfMeasure(before: string): boolean {
  const at = before.toLowerCase().lastIndexOf("half");
  if (at < 0) return false;
  const between = before.slice(at + 4);
  if (/[½]|\b1\/2\b/.test(before.slice(-14))) return true;
  return !between.includes("£");
}

const PRICE_PATTERN = /£\s?(\d{1,2}(?:\.\d{2})?)\b/g;

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
  const lastFigure = [...before.matchAll(PRICE_PATTERN)].at(-1);
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
  const priorPrices = [...before.matchAll(/£\s?\d{1,2}(?:\.\d{2})?\b/g)];
  const last = priorPrices.at(-1);
  if (last) {
    start = (last.index ?? 0) + last[0].length;
  }
  for (const sep of [". ", "; ", " | ", "| ", " - ", " - "]) {
    const at = before.lastIndexOf(sep, priceAt);
    if (at >= start) start = at + sep.length;
  }

  const raw = context.slice(start, priceAt).replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return normalizeHarvestDrinkLabel(raw);
}

/** Dedup key for site-harvest rows: category, printed name and explicit serving. */
export function siteHarvestPriceKey(
  category: DrinkCategory,
  drinkLabel?: string | null,
  servingSize?: string | null,
): string {
  const label = typeof drinkLabel === "string" ? drinkLabel.trim().toLowerCase() : "";
  const serving = typeof servingSize === "string" ? servingSize.trim().toLowerCase() : "";
  return `${category}\0${label}\0${serving}`;
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
      : context.slice(candidateAt).match(/^£\s?\d{1,2}(?:\.\d{2})?\b/)?.[0];
    if (!price) return null;
    const label = drinkLabelFromPriceContext(context, price, candidateAt);
    const match = label?.match(/^(.*?)(?:\s+)?(\d{2,3}\s*ml)$/i);
    if (!match) return null;
    currentMeasure ??= (match[2] ?? "").replace(/\s+/g, "").toLowerCase();
    const name = (match[1] ?? "").replace(/^[/|\s\u2013\u2014-]+$/, "").trim();
    if (name) return { drinkLabel: name, servingSize: currentMeasure };
    const prior = [...context.slice(0, candidateAt).matchAll(PRICE_PATTERN)].at(-1);
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
 * Strip a page to the text a reader sees. Scripts and styles go first, because
 * a price inside a JSON blob or a CSS rule is not something the page states.
 */
export function pageText(
  html: string,
  preserveItemBoundaries = false,
  sourceFormat: UkPriceSourceFormat = "text",
): string {
  const visibleSource = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const source = sourceFormat === "html"
    ? visibleSource.replace(/\s+/g, " ")
    : preserveItemBoundaries ? normalizeHtmlTextWhitespace(visibleSource) : visibleSource;
  return source
    .replace(/\s+/g, (space) => preserveItemBoundaries && /[\r\n]/.test(space) ? "\n" : " ")
    .replace(/<\/?(?:p|li|tr|div|section|article|h[1-6]|ul|ol|table|dl|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    // A NUMERIC REFERENCE IS THE CHARACTER IT NAMES, and leaving it undecoded
    // hides drink words: a spirits list states `Bosford Ros&#233;`, which is not
    // a wine to any pattern here, and `&#163;` is not a price to any of them.
    .replace(/&#(\d{1,7});/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, (space) => preserveItemBoundaries && space.includes("\n") ? "\n" : " ")
    .trim();
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

/** Price ordinals and item text inside a wine section, never its siblings. */
function wineSectionPrices(html: string): Map<number, { text: string; raw: UkPriceRawCandidate }> {
  const prices = new Map<number, { text: string; raw: UkPriceRawCandidate }>();
  if (!/(?:\bmenubox\b|<section\b|<article\b)/i.test(html)) return prices;
  const document = parse(html, { sourceCodeLocationInfo: true });
  const paragraphs: { start: number; end: number; text: string }[] = [];

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
          inWineSection = /^(?:white|red|ros[eé]|(?:white|red|ros[eé]) wines?|wines?)$/i.test(
            pageText(serializeOuter(item)),
          );
        } else if (item.tagName === "p" && inWineSection) {
          const location = item.sourceCodeLocation;
          if (location?.startOffset == null || !location.endOffset) continue;
          paragraphs.push({
            start: location.startOffset,
            end: location.endOffset,
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
    for (const [index, raw] of findUkPriceCandidates(paragraph.text).entries()) {
      prices.set(prefixCount + index, { text: paragraph.text, raw });
    }
    cursor = paragraph.start;
  }
  return prices;
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
  for (const match of text.matchAll(PRICE_PATTERN)) {
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
    const ownTitle = titleCategory(itemName.own);
    if (ownTitle) return { category: ownTitle, fromMixer: false };
    const ownCategory = categoryDecisionFor(itemName.own, itemName.own.length)?.category ?? null;
    if (itemName.preceding.some((line) => {
      const precedingTitle = titleCategory(line);
      return precedingTitle !== null && precedingTitle !== ownCategory;
    })) return "item-name-ambiguous";
  }
  const decision = categoryDecisionFor(drinkLabel, drinkLabel.length);
  // A named soda with no alcoholic word is not evidence that a neighbouring
  // item's beer, wine or spirit word belongs to this price.
  if (!decision) return /\bsoda\b/i.test(drinkLabel) ? "no-category-word-nearby" : null;
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

function keylessPriceDropReason(
  category: DrinkCategory,
  priceGbp: number,
  context: string,
): UkPriceDropReason | null {
  const band = CATEGORY_PRICE_BANDS[category];
  if (!band) return "no-category-word-nearby";
  if (!Number.isFinite(priceGbp) || priceGbp < band.minGbp || priceGbp > band.maxGbp) {
    return "outside-category-band";
  }
  if (FOOD_WORDS.test(context) || FOOD_WEARING_A_DRINK_WORD.test(context)) {
    return "food-word-nearby";
  }
  return null;
}

/** Tea, water and affogato lines never file as coffee, whatever sits beside them. */
function coffeeLineExcluded(
  category: DrinkCategory,
  drinkLabel: string | null | undefined,
  text: string,
  at: number,
): boolean {
  if (category !== "coffee") return false;
  return coffeePriceLabelExcluded(drinkLabel ?? printedItemName(text, at)?.own);
}

/**
 * Keyless regex table for one £ figure already located on `text`.
 * Used for the default path and for a TypeSafe batch that failed mid-page.
 */
function decideKeylessUkPriceAt(
  text: string,
  at: number,
  priceGbp: number,
  verbatim: string,
  inWineSection = false,
): { kept?: UkPriceCandidate; drop?: UkPriceDropReason } {
  const contextStart = Math.max(0, at - PRICE_CONTEXT_CHARS);
  const context = text.slice(
    contextStart,
    at + verbatim.length + PRICE_CONTEXT_CHARS,
  );
  const priceAtInContext = at - contextStart;

  if (!text.includes(verbatim)) {
    return { drop: "not-verbatim-on-page" };
  }
  if (OFFER_WORDS.test(context)) {
    return { drop: "offer-not-a-menu-price" };
  }
  const drinkLabel =
    drinkLabelFromPriceContext(context, verbatim, priceAtInContext) ?? undefined;
  const decisionFromLabel = categoryDecisionFromLabel(drinkLabel, printedItemName(text, at));
  if (typeof decisionFromLabel === "string") return { drop: decisionFromLabel };
  const statedIdentity = statedWineIdentity(context, verbatim, priceAtInContext);
  const wineIdentity = statedIdentity && (inWineSection || categoryDecisionFor(
    statedIdentity.drinkLabel, statedIdentity.drinkLabel.length,
  )?.category === "wine") ? statedIdentity : null;
  if (!wineIdentity && (
    /^[/|\s\u2013\u2014-]*\d{2,3}\s*ml$/i.test(drinkLabel ?? "")
    || (statedIdentity && (!decisionFromLabel || decisionFromLabel.category === "wine"))
  )) {
    return { drop: "no-category-word-nearby" };
  }
  const decision = decisionFromLabel ?? (wineIdentity
    ? { category: "wine" as const, fromMixer: false }
    : categoryDecisionFor(context, at - contextStart));
  if (!decision) {
    return {
      drop: Number.isFinite(priceGbp) ? "no-category-word-nearby" : "no-drink-word-nearby",
    };
  }
  if (decision.fromMixer) {
    return { drop: "mixer-serve-not-one-drink" };
  }
  const category = decision.category;
  if (coffeeLineExcluded(category, drinkLabel, text, at)) {
    return { drop: "no-category-word-nearby" };
  }
  const drop = keylessPriceDropReason(category, priceGbp, context);
  if (drop) return { drop };
  // A preceding item's printed measure cannot turn this item's pint into a
  // bottle. A paired price has no second label, so it keeps the nearby context.
  const before = drinkLabel ?? text.slice(Math.max(0, at - 30), at);
  const after = text.slice(at + verbatim.length, at + verbatim.length + 6);
  if (category === "beer" && (isHalfMeasure(before) || isFirstOfAMeasurePair(after))) {
    return { drop: "half-measure-not-a-pint" };
  }
  if (category === "beer" && isBottledMeasure(before)) {
    return { drop: "bottled-measure-not-a-pint" };
  }
  return {
    kept: {
      priceGbp,
      category,
      verbatim,
      context,
      drinkLabel: category === "wine" ? wineIdentity?.drinkLabel ?? drinkLabel : drinkLabel,
      ...(category === "wine" && wineIdentity ? { servingSize: wineIdentity.servingSize } : {}),
    },
  };
}

export function decideKeylessUkPriceCandidate(
  text: string,
  raw: UkPriceRawCandidate,
  inWineSection = false,
): { kept?: UkPriceCandidate; drop?: UkPriceDropReason } {
  // The candidate's own offset, never a fresh search: see `at` on the type.
  if (text.startsWith(raw.verbatim, raw.at)) {
    return decideKeylessUkPriceAt(text, raw.at, raw.priceGbp, raw.verbatim, inWineSection);
  }
  return { drop: "not-verbatim-on-page" };
}

export function readKeylessUkPriceDecisions(
  html: string,
  sourceFormat: UkPriceSourceFormat = "text",
): Map<number, ReturnType<typeof decideKeylessUkPriceCandidate>> {
  const text = pageText(html, true, sourceFormat);
  const decisions = new Map<number, ReturnType<typeof decideKeylessUkPriceCandidate>>();
  const candidates = findUkPriceCandidates(text);
  const winePrices = wineSectionPrices(html);

  for (const [index, raw] of candidates.entries()) {
    const scoped = winePrices.get(index);
    const scopedIdentity = scoped
      ? statedWineIdentity(scoped.text, scoped.raw.verbatim, scoped.raw.at)
      : null;
    const outcome = scopedIdentity && scoped
      ? decideKeylessUkPriceCandidate(scoped.text, scoped.raw, true)
      : decideKeylessUkPriceCandidate(text, raw);
    decisions.set(raw.at, outcome);
  }

  return decisions;
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

/**
 * Whether a page on a MULTI-PUB host may speak for one named pub.
 *
 * A host serving one pub is that pub's own site, and every page on it is about
 * that pub. A host serving an estate is not: its homepage price is an estate
 * banner, and attributing it to each pub on the host turns one figure into
 * hundreds of wrong ones. So an estate page has to NAME the pub in its own URL
 * before its price may be that pub's.
 */
export function pageMayPriceThisPub(
  pageUrl: string,
  pub: { name?: string | null },
  pubsOnHost: number,
): boolean {
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
