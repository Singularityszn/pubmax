// How a drink tag from a price source reads on screen. A pure leaf with no
// imports, so a client card can format a drink name without pulling a page's
// data tables into its bundle.

/**
 * The tokens a shouted drink tag is allowed to keep in capitals. It is an
 * EXPLICIT list rather than a length rule: "NECK OIL" and "IPA" are both two
 * short words, and only one of them is an acronym, so a rule counting letters
 * printed "Neck OIL" - a half-shout worse than the untouched tag. Anything
 * absent here title-cases, however short.
 */
const CAPITALISED_DRINK_TOKENS = new Set([
  "IPA",
  "APA",
  "DIPA",
  "NEIPA",
  "ESB",
  "XPA",
]);

/**
 * A drink tag is title-cased when the dataset shouted it; the known all-caps
 * beer tokens stay. The word pattern is Unicode, because an accented shout
 * ("GOLDBRAÜ") split on the accent under an ASCII class and came back out
 * half-shouted.
 */
export function formatDrinkTagName(name: string): string {
  return name.replace(/\p{L}[\p{L}\p{N}'’.-]*/gu, (word) => {
    if (word !== word.toUpperCase()) return word;
    if (CAPITALISED_DRINK_TOKENS.has(word)) return word;
    return `${word.charAt(0)}${word.slice(1).toLowerCase()}`;
  });
}
