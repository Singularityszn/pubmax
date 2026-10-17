// What a pub's own FOOD menu states, and nothing it does not.
//
// The drink reader in ./ukPriceCrawl.ts throws food away on purpose: a figure
// with a plate word beside it is not the price of a pint. This module is the
// other half of that decision. It reads the SAME page text the drink lanes
// read (`pageText`) and keeps a dish only when the page states the dish's name
// and its £ figure in one place, under a food section or beside a food word.
//
// THREE RULES, each of them a drop with a name rather than a silent gap.
// (1) A FIGURE IS A DISH PRICE ONLY WHEN IT STANDS ALONE. Offers ("2 for £15"),
//     add-ons ("add bacon £1.50"), set menus, per-person figures and a line
//     carrying two figures are dropped, because none of them is what one dish
//     costs. (2) A DRINK IS NOT A DISH: a line under a drinks heading, or a
//     line whose name carries a drink word and no food word, is the drink
//     lanes' business. (3) A PAGE IS A MENU OR IT IS NOTHING: fewer than
//     `MIN_DISHES_FOR_MENU` kept dishes reads as a banner or a promo shelf, and
//     the page yields no rows at all.
//
// The category comes from the section heading the dish sits under. A dish
// with no heading above it is filed `other` rather than guessed into `mains`,
// because a category is a claim about the menu and the menu did not make it.

import { categoryFor, pageText, type UkPriceSourceFormat } from "./ukPriceCrawl";

export type FoodCategory =
  | "breakfast"
  | "starters"
  | "sharers"
  | "mains"
  | "burgers"
  | "short-eats"
  | "bar-snacks"
  | "sides"
  | "desserts"
  | "other";

export const UK_FOOD_DROP_REASONS = [
  "offer-or-add-on",
  "several-prices-on-line",
  "outside-food-band",
  "no-item-name",
  "drink-section",
  "drink-line",
  "no-food-context",
  "duplicate-item",
] as const;
export type UkFoodDropReason = (typeof UK_FOOD_DROP_REASONS)[number];

export type UkFoodDish = {
  itemName: string;
  category: FoodCategory;
  priceGbp: number;
  /** The menu's own words for this dish, verbatim, for the harvest ledger only. */
  quote: string;
};

export type UkFoodReading = {
  kept: UkFoodDish[];
  drops: Partial<Record<UkFoodDropReason, number>>;
  /** Every £ figure the page states, kept or not. */
  figures: number;
};

/** A dish costs at least this, and a pub dish never more than the ceiling. */
export const FOOD_PRICE_FLOOR_GBP = 1;
export const FOOD_PRICE_CEILING_GBP = 60;

/**
 * How many dishes a page has to state before it counts as a MENU. The drink
 * lanes' floor is four for the same reason: a homepage promo states one or two.
 */
export const MIN_DISHES_FOR_MENU = 4;

const FIGURE = /£\s?(\d{1,3}(?:\.\d{2})?)(?![\d.]*\d)/g;

/**
 * Section headings, tested in order so the narrower name wins: "burger" is a
 * burger before it is a main, and "sunday roast" is a main before it is a
 * breakfast-adjacent word.
 */
const FOOD_SECTIONS: ReadonlyArray<{ category: FoodCategory; pattern: RegExp }> = [
  { category: "breakfast", pattern: /\b(breakfasts?|brunch)\b/i },
  { category: "burgers", pattern: /\bburgers?\b/i },
  { category: "desserts", pattern: /\b(desserts?|puddings?|sweets|afters)\b/i },
  { category: "sides", pattern: /\b(sides?|extras|on the side)\b/i },
  { category: "bar-snacks", pattern: /\b(bar snacks?|bar bites|nibbles|snacks)\b/i },
  { category: "sharers", pattern: /\b(sharers?|sharing|to share|platters?|boards?)\b/i },
  { category: "starters", pattern: /\b(starters?|small plates|to start|appeti[sz]ers?|soups?)\b/i },
  {
    category: "short-eats",
    pattern: /\b(sandwich(?:es)?|wraps?|baguettes?|ciabattas?|light bites|lunchtime|toasties)\b/i,
  },
  {
    category: "mains",
    pattern:
      /\b(mains?|main courses?|pub classics|classics|grills?|from the grill|roasts?|pies|steaks?|pizzas?|salads?|large plates|curr(?:y|ies)|fish)\b/i,
  },
];

const DRINK_SECTION =
  /\b(drinks?|wines?|beers?|ales?|ciders?|lagers?|draught|cocktails?|mocktails?|spirits|gins?|whisk(?:e)?ys?|rums?|vodkas?|soft drinks?|hot drinks|coffees?|teas?|fizz|champagnes?|prosecco|on tap)\b/i;

/** A heading that ends the menu part of a page: nothing below it is a dish. */
const NON_MENU_SECTION =
  /\b(allergens?|opening hours|opening times|find us|contact|gift cards?|vouchers?|events|what'?s on|book a table|jobs|careers)\b/i;

const OFFER_OR_ADD_ON =
  /(\b\d+\s+for\b|\btwo for\b|\bhappy hour\b|\boffer|\bsave\b|\bwas\b|\bonly\b|\bfrom\b|\bdeal\b|\bpromo|\bdiscount|\bfree\b|\bbottomless\b|\bunlimited\b|\bper (?:person|head)\b|\bpp\b|\bvoucher|\bwhen you\b|\bterms\b|\bset menu\b|\b(?:two|three|2|3) courses?\b|^\s*(?:add|extra|upgrade|swap|supplement)\b|\+\s*£|\badd\s+(?:a|an|some|extra)?\s*\w+\s+(?:for\s+)?£)/i;

/**
 * Words that mean a line is about a plate. The drink lane's own list reads the
 * same, because one rule should have one vocabulary.
 */
const FOOD_WORDS =
  /\b(burger|steak|pizza|roast|breakfast|brunch|sandwich|wrap|baguette|ciabatta|toastie|curry|fish|chips|fries|dessert|sundae|platter|sharer|starter|main|side|salad|bread|soup|squid|calamari|scampi|prawns?|crab|lobster|oysters?|mussels|chicken|beef|pork|lamb|duck|sausages?|bangers|mash|parfait|p[aâ]t[eé]|terrine|risotto|pasta|gnocchi|lasagne|pie|cheese|ploughman'?s?|nachos|wings|halloumi|burrata|tart|cake|brownie|cheesecake|crumble|pudding|ice cream|sorbet|eggs?|bacon|avocado|mushrooms?|tofu|falafel|hummus|olives|whitebait|haddock|cod|salmon|hake|seabass|sea bass|ribs?|brisket|gammon|scotch egg|pork pie|crisps|onion rings|coleslaw|gravy|yorkshire|vegan|vegetarian)\b/i;

/** A dish that borrows a drink's word: "beer-battered", "prawn cocktail". */
const FOOD_WEARING_A_DRINK_WORD =
  /\b(?:(?:crab|prawn|shrimp|seafood|fruit)\s+cocktail|beer[- ]battered|ale[- ]battered|cider[- ]braised|wine[- ]braised|gin[- ]cured|whisk(?:e)?y sauce|rum baba|ale pie)\b/i;

const MARKDOWN_MARKERS = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+|\|)+/;
const LEADERS = /[\s.·…\-–—|:]+$/;

function cleanLine(line: string): string {
  return line
    .replace(MARKDOWN_MARKERS, "")
    .replace(/\*\*|__/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function figuresOn(line: string): string[] {
  return [...line.matchAll(FIGURE)].map((match) => match[1] ?? "");
}

type Section = { kind: "food"; category: FoodCategory } | { kind: "drink" } | { kind: "end" };

/** A line that reads as a dish's description rather than its name. */
function isDescription(line: string): boolean {
  const words = line.split(/\s+/).length;
  return words > 6 || /[.!]$/.test(line) || (words > 3 && /,/.test(line));
}

function headingFor(line: string): Section | null {
  if (line.length === 0 || line.length > 40 || figuresOn(line).length > 0) return null;
  // A heading is a label, not a sentence: a line with a full stop in it is copy.
  if (/[.!?]\s|[.!?]$/.test(line)) return null;
  if (line.split(/\s+/).length > 5) return null;
  if (NON_MENU_SECTION.test(line)) return { kind: "end" };
  const food = FOOD_SECTIONS.find((entry) => entry.pattern.test(line));
  if (food) return { kind: "food", category: food.category };
  // "Beer-battered haddock" and "Coffee & walnut cake" are dishes, not lists.
  if (DRINK_SECTION.test(line) && !FOOD_WORDS.test(line) && !FOOD_WEARING_A_DRINK_WORD.test(line)) {
    return { kind: "drink" };
  }
  return null;
}

function usableName(candidate: string): string | null {
  const name = candidate.replace(LEADERS, "").replace(/^[\s.·…\-–—|:]+/, "").trim();
  if (name.length < 3 || name.length > 70) return null;
  if (!/[a-z]{2}/i.test(name)) return null;
  const words = name.split(/\s+/);
  if (words.length > 12) return null;
  // A sentence is a description, not a dish's name.
  if (words.length > 6 && /\.$/.test(name)) return null;
  return name;
}

function isDrinkName(text: string): boolean {
  if (FOOD_WEARING_A_DRINK_WORD.test(text)) return false;
  if (FOOD_WORDS.test(text)) return false;
  return categoryFor(text, 0) !== null || categoryFor(text) !== null;
}

/**
 * How many of the waiting lines are settled headings when a figure arrives.
 *
 * With the dish's name on the figure's own line, every heading above it is a
 * heading. Otherwise the dish starts after the LAST heading that still has a
 * name, not a description, standing below it. A drinks or end-of-menu heading
 * names no dish, so it is a heading wherever it sits.
 */
function settledHeadingCount(pending: readonly string[], nameIsInline: boolean): number {
  if (nameIsInline) return pending.length;
  let settled = 0;
  pending.forEach((waiting, i) => {
    const heading = headingFor(waiting);
    if (!heading) return;
    const next = pending[i + 1];
    if (heading.kind !== "food" || (next !== undefined && !isDescription(next))) settled = i + 1;
  });
  return settled;
}

/** The nearest line above a figure that is not a description: menus print name, description, price. */
function nameAbove(lines: readonly string[]): string {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line && !isDescription(line)) return line;
  }
  return "";
}

/** Why a priced line is not one dish's price, before its name is even read. */
function figureDropReason(line: string, stated: readonly string[]): UkFoodDropReason | null {
  if (stated.length > 1) return "several-prices-on-line";
  if (OFFER_OR_ADD_ON.test(line)) return "offer-or-add-on";
  const priceGbp = Number(stated[0]);
  if (!Number.isFinite(priceGbp) || priceGbp < FOOD_PRICE_FLOOR_GBP || priceGbp > FOOD_PRICE_CEILING_GBP) {
    return "outside-food-band";
  }
  return null;
}

type DishDecision = { dish: UkFoodDish } | { drop: UkFoodDropReason } | { skip: true };

/** Decide one priced line, given the lines waiting above it and the section it sits in. */
function decideDish(line: string, stated: readonly string[], above: readonly string[], section: Section | null): DishDecision {
  if (section?.kind === "end") return { skip: true };
  const figureDrop = figureDropReason(line, stated);
  if (figureDrop) return { drop: figureDrop };
  if (section?.kind === "drink") return { drop: "drink-section" };

  const beforeFigure = line.slice(0, line.search(/£/)).trim();
  const inlineName = usableName(beforeFigure);
  const nameLine = inlineName ? beforeFigure : nameAbove(above);
  const itemName = inlineName ?? (nameLine ? usableName(nameLine) : null);
  if (!itemName) return { drop: "no-item-name" };
  const context = [...above, line];
  const quoteStart = inlineName ? context.length - 1 : context.indexOf(nameLine);
  const quote = context.slice(quoteStart).join(" / ").slice(0, 240);

  if (isDrinkName(itemName)) return { drop: "drink-line" };
  const inFoodSection = section?.kind === "food";
  if (!inFoodSection && !FOOD_WORDS.test(quote)) return { drop: "no-food-context" };
  const category: FoodCategory = section?.kind === "food" ? section.category : "other";
  return { dish: { itemName, category, priceGbp: Number(stated[0]), quote } };
}

/**
 * Every dish a page states, with each rejection counted.
 *
 * `format` is the price lanes' own switch: "html" for a served document, "text"
 * for a rendered page's markdown or a PDF's text layer.
 */
export function readVenueFoodPrices(source: string, format: UkPriceSourceFormat = "html"): UkFoodReading {
  const lines = pageText(source, true, format).split("\n").map(cleanLine);
  const kept: UkFoodDish[] = [];
  const drops: Partial<Record<UkFoodDropReason, number>> = {};
  const seen = new Set<string>();
  let section: Section | null = null;
  // The lines since the last dish: a dish's name and its description often sit
  // above its figure rather than beside it. A heading-shaped line waits here
  // too, because on a rendered menu a DISH is often a heading ("#### Fish
  // Pie") and only the line after it can say which of the two it was.
  let pending: string[] = [];
  let figures = 0;
  const commit = (waiting: readonly string[]) => {
    for (const line of waiting) section = headingFor(line) ?? section;
  };

  for (const line of lines) {
    if (!line) continue;
    const stated = figuresOn(line);
    if (stated.length === 0) {
      pending.push(line);
      if (pending.length > 4) commit(pending.splice(0, 1));
      continue;
    }
    figures += stated.length;
    const nameIsInline = usableName(line.slice(0, line.search(/£/)).trim()) !== null;
    const settled = settledHeadingCount(pending, nameIsInline);
    commit(pending.slice(0, settled));
    const above = pending.slice(settled);
    pending = [];

    const decision = decideDish(line, stated, above, section);
    if ("skip" in decision) continue;
    if ("drop" in decision) {
      drops[decision.drop] = (drops[decision.drop] ?? 0) + 1;
      continue;
    }
    const key = `${decision.dish.itemName.toLowerCase()}\u0000${decision.dish.category}`;
    if (seen.has(key)) {
      drops["duplicate-item"] = (drops["duplicate-item"] ?? 0) + 1;
      continue;
    }
    seen.add(key);
    kept.push(decision.dish);
  }
  return { kept, drops, figures };
}

/** Whether a page states enough dishes to be a menu rather than a promo shelf. */
export function pageStatesAFoodMenu(reading: UkFoodReading): boolean {
  return reading.kept.length >= MIN_DISHES_FOR_MENU;
}

// --- page discovery -------------------------------------------------------
//
// The drink lane's link finder excludes lunch, dinner and Sunday-roast pages
// because they are food. This one wants exactly those, and excludes drinks
// lists, set menus and seasonal party menus, whose figures are per head.

const FOOD_LINK_WORDS =
  /(menus?|food|eat|kitchen|lunch|dinner|supper|brunch|breakfast|sunday|bar[- ]?snacks|small[- ]?plates|dishes)/i;

const FOOD_LINK_EXCLUSIONS =
  /(privacy|cookie|terms|careers|jobs|vacanc|gift[- ]?card|voucher|contact|accessib|sitemap|login|account|basket|checkout|book(ing)?|wedding|funeral|christening|conference|newsletter|blog|news\/|\/tag\/|\/author\/|feed|\/shop\/|\/store\/|products?\/|drinks?|wine|cocktail|beer|christmas|festive|new[- ]?year|valentine|mothers?[- ]?day|fathers?[- ]?day|set[- ]?menu|group|party|parties|function|private[- ]?hire|kids|children|allergen)/i;

const READABLE_ENDINGS = /(\.pdf|\.html?|\/)$/i;

export function isLikelyFoodMenuUrl(candidate: string, siteOrigin: string): boolean {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(candidate, siteOrigin);
    origin = new URL(siteOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // SAME SITE ONLY: a pub's own site is first party; a site it links to is a
  // source with its own permission question this crawl has not asked.
  const host = url.hostname.replace(/^www\./, "");
  const known = origin.hostname.replace(/^www\./, "");
  if (host !== known && !host.endsWith(`.${known}`)) return false;
  const path = `${url.pathname}${url.search}`;
  if (FOOD_LINK_EXCLUSIONS.test(path)) return false;
  if (!FOOD_LINK_WORDS.test(path)) return false;
  if (!READABLE_ENDINGS.test(url.pathname) && /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return false;
  return true;
}

/** Candidate food-menu URLs among `urls`, deduplicated, in order, capped. */
export function foodMenuUrlsFrom(urls: Iterable<string>, siteOrigin: string, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed || trimmed.startsWith("#") || /^(mailto|tel|javascript):/i.test(trimmed)) continue;
    if (!isLikelyFoodMenuUrl(trimmed, siteOrigin)) continue;
    let resolved: string;
    try {
      resolved = new URL(trimmed, siteOrigin).toString().replace(/#.*$/, "");
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= max) break;
  }
  return out;
}

/** The `href`s a served document states, for `foodMenuUrlsFrom`. */
export function htmlLinks(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
}
