// Shoreditch coffee pilot: the harvest word list and the misread guard shared by
// ukPriceCrawl, ukPriceJudgment.server and its fence test. Tea, water and
// affogato never file as coffee, and matcha counts as a coffee word.

const COFFEE_WORDS_BESIDE_TEA_OR_WATER =
  /\b(espresso|americano|cappuccino|latte|flat\s+white|mocha|matcha)\b/i;

const TEA_OR_WATER_WORDS =
  /\b(tea|water|earl\s+grey|english\s+breakfast|chai|peppermint|herbal|green)\b/i;

/** Coffee vocabulary for the UK price reader. Matcha is a coffee word on its own. */
export const COFFEE_HARVEST_WORD_PATTERN =
  /\b(coffee|espresso|americano|cappuccino|latte|flat white|mocha|matcha)\b/i;

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
  // "americano, espresso and hot water") is a coffee line.
  return !COFFEE_WORDS_BESIDE_TEA_OR_WATER.test(normalized);
}
