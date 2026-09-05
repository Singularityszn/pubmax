// BROWSER-SAFE LEAF. What SERVING a logged price is about, and nothing else.
//
// Contribution battle test D04 (5 Sept 2026): a Pint Drop of `drink: "Half of
// lager", priceGbp: 2.6` was accepted into the pint lane, a second drinker
// confirmed it as "£2.60 a pint", and that £2.60 then fed pin colour, the
// cheapest-pint buckets and the Pint Index at a pub whose pint is £5.50. The
// composer's own drink placeholder invited the word: "Pint, half, soda, guest
// ale". Neither price lane carried a measure, so the drink TEXT was the only
// place a half could be said and no reader ever asked it.
//
// Firstmate's decision on the captain's delegation: a CLOSED measure, default
// `pint`, stored beside the price. A half is stored with its measure and is
// NEVER scaled and NEVER shown as a pint. Scaling is the tempting fix and it is
// the wrong one: a half of lager is not half the price of a pint of it, pubs
// price the two apart, and doubling a figure would publish a price nobody paid
// under the word of the drinker who paid the other one.
//
// This module imports NOTHING, on the leaf law in AGENTS.md: the composer, the
// validator, the store mapper, the read lanes and the Index producer all need
// the same answer, and a browser bundle that needs the word "Half" must not
// pull the venue index in behind it.

/** The closed set. `other` carries a free label; `pint` and `half` name themselves. */
export const DRINK_MEASURES = ["pint", "half", "other"] as const;
export type DrinkMeasure = (typeof DRINK_MEASURES)[number];

/**
 * What a price is about when nobody said otherwise, and what every row written
 * before migration 0147 reads as. That is the honest default in both
 * directions: the pint lane already assumed it of every legacy row, so the
 * default changes nothing, and the migration's backfill is what takes the rows
 * that SAY half or small back out of the lane again.
 */
export const DEFAULT_DRINK_MEASURE: DrinkMeasure = "pint";

/** The word each measure prints, on a chip and beside a figure alike. */
export const DRINK_MEASURE_LABEL: Record<DrinkMeasure, string> = {
  pint: "Pint",
  half: "Half",
  other: "Other",
};

/** Cap on the free label an `other` measure may carry. */
export const DRINK_MEASURE_LABEL_MAX = 24;

const MEASURE_SET: ReadonlySet<string> = new Set(DRINK_MEASURES);

/**
 * Coerce an untrusted value to a DrinkMeasure. Forgiving in ONE direction only:
 * anything off the allowlist collapses to `pint`, which is what the lane
 * already assumed, so an old client that sends no measure behaves exactly as
 * before. A caller that needs to know whether a measure was STATED asks
 * `statedDrinkMeasure` instead.
 */
export function cleanDrinkMeasure(value: unknown): DrinkMeasure {
  if (typeof value === "string" && MEASURE_SET.has(value)) return value as DrinkMeasure;
  return DEFAULT_DRINK_MEASURE;
}

/** The measure a value STATES, or null when it states none. */
export function statedDrinkMeasure(value: unknown): DrinkMeasure | null {
  if (typeof value === "string" && MEASURE_SET.has(value)) return value as DrinkMeasure;
  return null;
}

/**
 * THE ONE PREDICATE the pint lane reads. An absent measure is a pint, so every
 * row written before 0147 keeps the lane it already had.
 */
export function measureIsPint(measure: DrinkMeasure | null | undefined): boolean {
  return cleanDrinkMeasure(measure ?? DEFAULT_DRINK_MEASURE) === "pint";
}

/** Trim and cap the free label an `other` measure carries. */
export function cleanDrinkMeasureLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DRINK_MEASURE_LABEL_MAX);
}

/**
 * What a row's measure is CALLED on a surface: the free label when an `other`
 * measure carries one, else the closed word.
 */
export function drinkMeasureName(
  measure: DrinkMeasure | null | undefined,
  label?: string | null,
): string {
  const clean = cleanDrinkMeasure(measure);
  if (clean !== "other") return DRINK_MEASURE_LABEL[clean];
  const free = cleanDrinkMeasureLabel(label);
  return free || DRINK_MEASURE_LABEL.other;
}

/**
 * The measure words a drink TEXT may name, and which measure each one means.
 *
 * Word-bounded on purpose: `half` as a whole word catches "Half of lager" and
 * leaves "Halfway House Pale" alone. The SQL backfill in migration 0147 mirrors
 * this table and `__tests__/drinkMeasureMigration.test.ts` holds the two
 * together, because this module is the owner and the migration is the copy.
 */
export const NON_PINT_MEASURE_PATTERNS: ReadonlyArray<{
  readonly word: string;
  readonly measure: Exclude<DrinkMeasure, "pint">;
}> = [
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

function boundedPattern(word: string): RegExp {
  // A fraction glyph or a slashed fraction carries no word characters at its
  // edges, so a word boundary would refuse it. Bound those on whitespace or a
  // string edge instead.
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[a-z]+$/.test(word)
    ? new RegExp(`\\b${escaped}\\b`, "i")
    : new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i");
}

/**
 * The non-pint measure a drink text NAMES, or null. Used twice: the write path
 * refuses a pint-measured drop whose own words say half, and the migration
 * FLAGS a legacy row the same way.
 */
export function measureNamedInDrinkText(
  text: unknown,
): Exclude<DrinkMeasure, "pint"> | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  for (const entry of NON_PINT_MEASURE_PATTERNS) {
    if (boundedPattern(entry.word).test(text)) return entry.measure;
  }
  return null;
}

/**
 * The one line a refused submission reads. It hands the drinker the action
 * rather than closing the door, which is the friction rule in docs/VOICE.md.
 */
export const MEASURE_ASK_LINE =
  "Pick the measure first, so a half never reads as a pint.";

/** The composer's own label above the measure chips. */
export const MEASURE_FIELD_LABEL = "What measure?";

/** What the `other` measure's free field asks for. */
export const MEASURE_OTHER_PLACEHOLDER = "Schooner, third, bottle";
