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

const PILOT_DRINK_ORDER: ReadonlyArray<{
  id: CoffeePilotNamedDrink;
  pattern: RegExp;
}> = [
  { id: "matcha latte", pattern: /\bmatcha\s+latte\b/i },
  { id: "flat white", pattern: /\bflat\s+white\b/i },
  // After matcha latte so "matcha latte" does not read as plain latte.
  { id: "latte", pattern: /\blatte\b/i },
];

const COFFEE_WORDS_BESIDE_TEA_OR_WATER =
  /\b(espresso|americano|cappuccino|latte|flat\s+white|mocha|macchiato|cortado|matcha)\b/i;

/**
 * Vocabulary for ukPriceCrawl and drinkCategoryFromText. Matcha is a coffee
 * word on its own; "matcha latte" is covered by both matcha and latte.
 */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|latte|flat white|mocha|matcha|macchiato|cortado)\b/i;

/**
 * A printed menu line that must never become a coffee price, even when a
 * neighbouring line or the word "espresso" appears in the same context window.
 */
export function coffeePriceLabelExcluded(label: string | null | undefined): boolean {
  if (typeof label !== "string") return false;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  if (/\baffogato\b/.test(normalized)) return true;
  if (!/\b(?:tea|water)\b/.test(normalized)) return false;
  return !COFFEE_WORDS_BESIDE_TEA_OR_WATER.test(normalized);
}

/** Map a printed name onto one pilot drink id, or null when it names none of them. */
export function canonicalCoffeePilotDrink(
  label: string | null | undefined,
): CoffeePilotNamedDrink | null {
  if (typeof label !== "string") return null;
  const normalized = label.trim();
  if (!normalized) return null;
  for (const { id, pattern } of PILOT_DRINK_ORDER) {
    if (pattern.test(normalized)) return id;
  }
  return null;
}
