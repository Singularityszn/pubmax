// Shoreditch coffee pilot: the harvest word list and the misread guard shared by
// ukPriceCrawl, ukPriceJudgment.server and its fence test. Tea, water and
// affogato never file as coffee, and matcha counts as a coffee word.

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
  // A tea line that also names a coffee word ("matcha tea latte") is a coffee line.
  return !COFFEE_WORDS_BESIDE_TEA.test(normalized);
}
