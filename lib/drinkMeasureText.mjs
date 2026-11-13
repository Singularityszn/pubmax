export const NON_PINT_MEASURE_PATTERNS = [
  { word: "half", measure: "half" },
  { word: "halves", measure: "half" },
  { word: "1/2", measure: "half" },
  { word: "½", measure: "half" },
  { word: "small", measure: "other" },
  { word: "schooner", measure: "other" },
  { word: "third", measure: "other" },
  { word: "thirds", measure: "other" },
  { word: "1/3", measure: "other" },
  { word: "⅓", measure: "other" },
  { word: "2/3", measure: "other" },
  { word: "⅔", measure: "other" },
];

function boundedPattern(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[a-z]+$/.test(word)
    ? new RegExp(`\\b${escaped}\\b`, "i")
    : new RegExp(`(^|[^\\w/])${escaped}(?=$|[^\\w/])`, "i");
}

/**
 * The words that put a measure word in a MEASURE CONTEXT when they follow it.
 *
 * Review finding F-22: word boundaries alone refused three real pints, because
 * London brewery names are made of measure words. "Other Half Green Diamond",
 * "Half Moon IPA" and "Small Beer Lager" are beers; "Third Wheel Bitter" is a
 * beer. A drinker typing one of those had a valid pint refused with a sentence
 * telling them to pick the measure they had already picked.
 */
const MEASURE_CONTEXT_WORDS = ["of", "a", "pint", "pints"];

const MEASURE_CONTEXT_SET = new Set(MEASURE_CONTEXT_WORDS);

/** The text as lowercase word tokens, so a measure word's neighbours can be read. */
function wordTokens(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "");
}

/**
 * Is this alphabetic measure word being used AS a measure?
 *
 * Three ways it is: it is the whole text, it ENDS the text ("Neck Oil half"),
 * or a measure context word follows it ("half of lager", "half a lager", "half
 * pint"). Anywhere else it is a name: a brewery, a beer or a pub.
 *
 * The direction of the remaining error is deliberate. A missed contradiction
 * here costs nothing on its own, because the composer now ASKS the measure on
 * both price doors and this predicate is the backstop behind that answer; a
 * false positive refuses a pint somebody really drank and tells them to fix
 * something that is not wrong.
 */
function usedAsMeasure(text, word) {
  const words = wordTokens(text);
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] !== word) continue;
    const next = words[i + 1];
    if (next === undefined) return true;
    if (MEASURE_CONTEXT_SET.has(next)) return true;
  }
  return false;
}

/**
 * The non-pint measure a drink text NAMES, or null. The TypeScript measure
 * module and the comparable-pint policy share this interpretation.
 *
 * A FRACTION IS ALWAYS A MEASURE. "1/2", "½", "2/3" and their kin carry no
 * other meaning in a drink name, so they are read wherever they appear; only
 * the spelled words need the context test above.
 */
export function measureNamedInDrinkText(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  for (const entry of NON_PINT_MEASURE_PATTERNS) {
    const spelled = /^[a-z]+$/.test(entry.word);
    const named = spelled
      ? usedAsMeasure(text, entry.word)
      : boundedPattern(entry.word).test(text);
    if (named) return entry.measure;
  }
  return null;
}

