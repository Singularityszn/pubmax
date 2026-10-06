// Shoreditch coffee pilot: the harvest word list and the misread guard shared by
// ukPriceCrawl, ukPriceJudgment.server and its fence test. Tea, water and
// affogato never file as coffee, and matcha counts as a coffee word.

const COFFEE_WORDS_BESIDE_TEA_OR_WATER =
  /\b(espresso|americano|cappuccino|flat\s+white|mocha|matcha)\b/i;

const TEA_OR_WATER_WORDS =
  /\b(tea|water|earl\s+grey|english\s+breakfast|chai|turmeric|peppermint|herbal|green)\b/i;

/** Coffee vocabulary for the UK price reader. Matcha is a coffee word on its own. */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|latte|flat white|mocha|matcha)\b/i;

const DRINK_NAME_WORDS = new RegExp(
  `${COFFEE_HARVEST_WORD_PATTERN.source}|${TEA_OR_WATER_WORDS.source}`,
  "i",
);

/**
 * A printed menu name that must never become a coffee price, even when a
 * neighbouring line or the word "espresso" sits in the same context window.
 */
export function coffeePriceLabelExcluded(label: string | null | undefined): boolean {
  if (typeof label !== "string") return false;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  if (/\baffogato\b/.test(normalized)) return true;
  if (!TEA_OR_WATER_WORDS.test(normalized)) return false;
  // A tea or water line that also names a coffee word ("matcha green tea latte",
  // "dirty chai with espresso", "americano, espresso and hot water") is a coffee line.
  return !COFFEE_WORDS_BESIDE_TEA_OR_WATER.test(normalized);
}

/**
 * A printed item read from its price line upward. The first line that names a
 * coffee, tea or water drink is the item's name, so a section heading above it
 * never decides, and a name line above a description-and-price line still does.
 * Affogato on any of the item's lines rules it out.
 */
export function coffeePriceItemExcluded(linesFromPrice: readonly string[]): boolean {
  if (linesFromPrice.some((line) => /\baffogato\b/i.test(line))) return true;
  return coffeePriceLabelExcluded(linesFromPrice.find((line) => DRINK_NAME_WORDS.test(line)));
}
