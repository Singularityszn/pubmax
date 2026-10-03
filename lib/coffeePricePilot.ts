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

const TEA_OR_WATER = /\b(?:tea|water)\b/i;
const AFFOGATO = /\baffogato\b/i;
const AFFOGATO_ITEM_HEADING = /^affogato(?:\s*\([^)]*\))*\s*[:\u2013\u2014-]?$/i;

/**
 * Whether a priced item must never become a coffee price. `ownLine` is the
 * item's own printed line; `precedingLines` are the unpriced lines since the
 * previous figure, nearest last. The item is affogato when its own line names
 * affogato or one of those lines is an "Affogato" item name, so a description
 * that names espresso stays affogato. A line that is exactly a pilot drink is
 * never refused, and a note such as "Affogato available on request" is not an
 * item name. Tea and water are judged on the own line, or on the line above
 * when the own line names no drink, so a "Tea & Coffee" section heading never
 * drops the coffee printed under it.
 */
export function coffeePriceLabelExcluded(
  ownLine: string | null | undefined,
  precedingLines: readonly string[] = [],
): boolean {
  const own = typeof ownLine === "string" ? ownLine.trim() : "";
  if (AFFOGATO.test(own)) return true;
  if (canonicalCoffeePilotDrink(own)) return false;
  if (precedingLines.some((line) => AFFOGATO_ITEM_HEADING.test(line.trim()))) return true;
  if (COFFEE_HARVEST_WORD_PATTERN.test(own)) return false;
  if (TEA_OR_WATER.test(own)) return true;
  const heading = precedingLines.at(-1)?.trim() ?? "";
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
