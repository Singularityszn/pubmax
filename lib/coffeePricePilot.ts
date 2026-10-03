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

/**
 * Whether a priced item must never become a coffee price. `ownLine` is the
 * item's own printed line; `label` is the fuller label that may carry the
 * name heading above it. Affogato is refused on either. Tea and water are
 * judged on the own line when it names a drink, so a "Tea & Coffee" heading
 * cannot drop the coffee under it, and fall back to the label otherwise.
 */
export function coffeePriceLabelExcluded(
  ownLine: string | null | undefined,
  label: string | null | undefined = ownLine,
): boolean {
  const own = typeof ownLine === "string" ? ownLine.trim() : "";
  const full = typeof label === "string" ? label.trim() : "";
  if (AFFOGATO.test(own) || AFFOGATO.test(full)) return true;
  if (COFFEE_HARVEST_WORD_PATTERN.test(own)) return false;
  if (TEA_OR_WATER.test(own)) return true;
  return TEA_OR_WATER.test(full) && !COFFEE_HARVEST_WORD_PATTERN.test(full);
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
