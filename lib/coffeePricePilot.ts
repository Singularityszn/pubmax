// Shoreditch coffee pilot: the named drinks, the harvest word list and the
// misread guard shared by ukPriceCrawl and its fence test. Tea, water and
// affogato never file as coffee, and matcha counts as a coffee word. The 73
// legacy `category: coffee` bundle rows stay committed as regression evidence.

/** The three drinks the Shoreditch pilot may show; each is its own price fact. */
export const COFFEE_PILOT_NAMED_DRINKS = ["flat white", "latte", "matcha latte"] as const;

export type CoffeePilotNamedDrink = (typeof COFFEE_PILOT_NAMED_DRINKS)[number];

// "matcha latte" comes before "latte" so it does not read as a plain latte.
const PILOT_DRINK_ORDER: ReadonlyArray<{ id: CoffeePilotNamedDrink; pattern: RegExp }> = [
  { id: "matcha latte", pattern: /\bmatcha\s+latte\b/i },
  { id: "flat white", pattern: /\bflat\s+white\b/i },
  { id: "latte", pattern: /\blatte\b/i },
];

const COFFEE_WORDS_BESIDE_TEA =
  /\b(espresso|americano|cappuccino|latte|flat\s+white|mocha|macchiato|cortado|matcha)\b/i;

/** Coffee vocabulary for the UK price reader. Matcha is a coffee word on its own. */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|latte|flat white|mocha|matcha|macchiato|cortado)\b/i;

/**
 * A printed menu name that must never become a coffee price, even when a
 * neighbouring line or the word "espresso" sits in the same context window.
 */
export function coffeePriceLabelExcluded(label: string | null | undefined): boolean {
  if (typeof label !== "string") return false;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  if (/\baffogato\b/.test(normalized)) return true;
  if (
    /\b(?:still|sparkling|bottled)\s+water\b/.test(normalized) ||
    (/\bwater\b/.test(normalized) &&
      /\b(?:highland|spring|bottled|sparkling|still)\b/.test(normalized))
  ) {
    return true;
  }
  if (!/\btea\b/.test(normalized)) return false;
  // A tea line that also names a pilot drink or a coffee word is a coffee line.
  if (PILOT_DRINK_ORDER.some(({ pattern }) => pattern.test(normalized))) return false;
  return !COFFEE_WORDS_BESIDE_TEA.test(normalized);
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
