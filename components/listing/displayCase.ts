/**
 * A drink name as a reader should see it, without touching the stored value.
 *
 * Some sources publish their menus in capitals ("BUD LIGHT", "PORTOBELLO",
 * "BONKERS CONKERS"), and printed as stored they shout on a page set in
 * sentence case (docs/DESIGN_SYSTEM.md, "Caps policy"). This only changes what
 * is rendered: a name already in mixed case is returned as it came, and an
 * all-capitals name is set in title case with its real acronyms kept.
 */

const KEEP_UPPER = new Set(["IPA", "APA", "DIPA", "NEIPA", "XPA", "ESB", "UK", "USA", "NZ", "DDH", "TNT"]);

function titleWord(word: string): string {
  if (KEEP_UPPER.has(word)) return word;
  // A hyphenated or bracketed part starts a new word ("PALE-ALE", "(KEG)").
  return word.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

export function displayDrinkName(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  // Mixed or lower case, or too short to judge (a three-letter "IPA"): leave it.
  if (letters.length < 4 || letters !== letters.toUpperCase()) return name;
  return name
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : titleWord(part)))
    .join("");
}

/**
 * Copy that came from a data file with an en or em dash in it ("Dean
 * Street–era", "Mayfair–Soho–Strand"), as the house style prints it: a
 * hyphen (docs/VOICE.md, "The em-dash law"). The stored text is untouched.
 */
export function plainDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ", ").replace(/–/g, "-");
}
