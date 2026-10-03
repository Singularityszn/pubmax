// Shoreditch coffee pilot: named drinks, harvest words and misread guards.
// -------------------------------------------------------------------------
// PR 1 of the coffee pilot fences the UK price reader so tea, water and
// affogato never file as coffee, matcha counts as a coffee word, and flat
// white, latte and matcha latte never collapse to one figure. The 73 legacy
// bundle rows stay as regression evidence; this module is what a fence test
// and ukPriceCrawl share.

/** The three drinks the Shoreditch pilot may show; each is its own price fact. */
export const COFFEE_PILOT_NAMED_DRINKS = [
  "flat white",
  "latte",
  "matcha latte",
] as const;

export type CoffeePilotNamedDrink = (typeof COFFEE_PILOT_NAMED_DRINKS)[number];

/**
 * Coffee vocabulary for the UK price reader and the tea and water fence below.
 * Matcha is a coffee word on its own; "matcha latte" is covered by both.
 */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|latte|flat white|mocha|matcha|macchiato|cortado)\b/i;

const TEA_OR_WATER = /\b(?:tea|chai|water)\b/i;
const AFFOGATO = /\baffogato\b/i;
const AFFOGATO_ITEM_HEADING = /^affogato(?:\s*\([^)]*\))*\s*[:\u2013\u2014-]?$/i;
/** Up to three leading words, none of them "with" or "in", before tea or water. */
const TEA_OR_WATER_ITEM = new RegExp(
  String.raw`^(?:(?!(?:with|in|into|using|over|from)\b)[\w'-]+\s+){0,3}` + TEA_OR_WATER.source,
  "i",
);
/** Up to two leading words before a coffee word: "Flat white", "Iced oat latte". */
const COFFEE_ITEM = new RegExp(
  String.raw`^(?:[\w'-]+\s+){0,2}` + COFFEE_HARVEST_WORD_PATTERN.source,
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
 * - An own line that names a coffee item is kept, whatever the copy around it:
 *   "Flat white" under "Affogato available on request" or an Affogato section.
 * - Otherwise the own line is a description. Under an "Affogato" item name it
 *   is refused; naming water it is kept only under a coffee name, so "Filter
 *   coffee" over "Brewed with filtered water" stays coffee.
 * - A description naming nothing is refused under a tea or water name.
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
  if (COFFEE_ITEM.test(own)) return false;
  if (lines.some((line) => AFFOGATO_ITEM_HEADING.test(line))) return true;
  if (TEA_OR_WATER.test(own)) {
    return !lines.some((line) => COFFEE_HARVEST_WORD_PATTERN.test(line));
  }
  if (coffeeAt >= 0) return false;
  const heading = lines.at(-1) ?? "";
  return TEA_OR_WATER.test(heading) && !COFFEE_HARVEST_WORD_PATTERN.test(heading);
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
