// Shoreditch coffee pilot: named drinks, harvest words and misread guards.
// -------------------------------------------------------------------------
// PR 1 of the coffee pilot fences the UK price reader so tea, water and
// affogato never file as coffee, matcha counts as a coffee word, and flat
// white, latte and matcha latte never collapse to one figure. The 85 legacy
// bundle rows stay as regression evidence; this module is what a fence test
// and ukPriceCrawl share.

import { COFFEE_PILOT_DRINKS } from "@/scripts/lib/coffeePilotArea.mjs";

/** The three drinks the Shoreditch pilot may show; each is its own price fact. */
export const COFFEE_PILOT_NAMED_DRINKS = COFFEE_PILOT_DRINKS;

export type CoffeePilotNamedDrink = (typeof COFFEE_PILOT_NAMED_DRINKS)[number];

/**
 * The words that file a line as coffee, for the UK price reader and the tea
 * and water fence below. `matcha` is here because a matcha latte is sold beside
 * the coffees. `latte` after `chai` or `tea` is a tea line, so "Chai latte"
 * never files as coffee.
 */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|(?<!\b(?:chai|tea)\s)latte|flat white|mocha|matcha|macchiato|cortado)\b/i;

const TEA = /\b(?:tea|chai)\b/i;
const TEA_OR_WATER = /\b(?:tea|chai|water)\b/i;
const AFFOGATO = /\baffogato\b/i;
const AFFOGATO_ITEM_HEADING = /^affogato(?:\s*\([^)]*\))*\s*[:\u2013\u2014-]?$/i;
/** Up to three leading words, none of them "with" or "in", before tea or water. */
const TEA_OR_WATER_ITEM = new RegExp(
  String.raw`^(?:(?!(?:with|in|into|using|over|from)\b)[\w'-]+\s+){0,3}` + TEA_OR_WATER.source,
  "i",
);
/**
 * A line that is just a coffee name: up to two leading words, the coffee word
 * last, then only tags in brackets or a separator. "Flat white", "Iced oat
 * latte", "Latte (oat)"; not "Espresso over vanilla gelato".
 */
const COFFEE_NAME = new RegExp(
  String.raw`^(?:[\w'-]+\s+){0,2}` +
    COFFEE_HARVEST_WORD_PATTERN.source +
    /(?:\s*\([^)]*\))*\s*[:|\u2013\u2014-]?$/.source,
  "i",
);

/**
 * Whether a priced item must never become a coffee price. `ownLine` is the
 * item's own printed line; `precedingLines` are the unpriced lines since the
 * previous figure, nearest last.
 *
 * - Affogato on the own line is refused.
 * - An own line that names tea, chai or water as the item, before any coffee
 *   word, is refused: "Chai tea latte", "Hot water", "Earl Grey Tea".
 * - The nearest line above that names a drink is the item's name. A tea or
 *   chai name with no coffee word refuses the item, so "Earl Grey tea" over
 *   "Latte" is tea.
 * - An own line that is just a coffee name is kept, whatever the copy around
 *   it: "Flat white" under "Affogato available on request" or "Affogato".
 * - Any other line under an "Affogato" item name is that dessert's
 *   description and is refused, even when it opens with espresso.
 * - An own line that names coffee is kept: "Filter coffee, brewed with water".
 * - Otherwise the item's name decides: a coffee name keeps it ("Filter
 *   coffee" over "Brewed with filtered water"), a water name refuses it. With
 *   no such name, a description that mentions tea or water is refused.
 */
export function coffeePriceLabelExcluded(
  ownLine: string | null | undefined,
  precedingLines: readonly string[] = [],
): boolean {
  const own = typeof ownLine === "string" ? ownLine.trim() : "";
  const lines = precedingLines.map((line) => line.trim());
  if (AFFOGATO.test(own)) return true;
  const coffeeAt = own.search(COFFEE_HARVEST_WORD_PATTERN);
  if (TEA_OR_WATER_ITEM.test(own) && (coffeeAt < 0 || own.search(TEA_OR_WATER) < coffeeAt)) {
    return true;
  }
  const name =
    lines.findLast(
      (line) => TEA_OR_WATER.test(line) || COFFEE_HARVEST_WORD_PATTERN.test(line),
    ) ?? "";
  if (TEA.test(name) && !COFFEE_HARVEST_WORD_PATTERN.test(name)) return true;
  if (COFFEE_NAME.test(own)) return false;
  if (lines.some((line) => AFFOGATO_ITEM_HEADING.test(line))) return true;
  if (coffeeAt >= 0) return false;
  if (COFFEE_HARVEST_WORD_PATTERN.test(name)) return false;
  return TEA_OR_WATER.test(name) || TEA_OR_WATER.test(own);
}

/**
 * Map a printed name onto one pilot drink id only when it is exactly that
 * drink, so "Chai latte" or "Latte macchiato" never stands in for a latte.
 */
export function canonicalCoffeePilotDrink(
  label: string | null | undefined,
): CoffeePilotNamedDrink | null {
  if (typeof label !== "string") return null;
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.:|\u2013\u2014-]+$/, "");
  return COFFEE_PILOT_NAMED_DRINKS.find((drink) => drink === normalized) ?? null;
}
