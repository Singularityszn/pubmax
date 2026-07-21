// Drink-weather rules — pure, no fetch, no React, no clock of its own.
//
// Maps tonight's cached conditions (temperature, chance of rain, month) to a
// venue lens, a drink to reach for, and one calm sensibility line. British
// sensibility, dry voice: state the weather and the obvious pint, never oversell
// it. Deterministic first-match-wins table; when nothing fits (a grey, in-between
// evening) it returns null and the caller renders no strip. We never invent a
// verdict to fill the space.
//
// The lens feeds an existing amenity/curation filter downstream:
//   beer-garden -> venue.amenities.beerGarden
//   riverside   -> venue.nearWater (curation)
//   fireplace   -> no amenity in the vocabulary, so no venue claim is made
//   any         -> no venue filter; the weather line stands alone

export type VenueLens = "beer-garden" | "fireplace" | "riverside" | "any";

export type DrinkWeatherInput = {
  /** Feels-like temperature in Celsius. */
  tempC: number;
  /** Chance of rain, 0-100. */
  precipitationProbabilityPct: number;
  /** Calendar month, 1 (January) to 12 (December). */
  month: number;
};

export type DrinkWeatherVerdict = {
  /** Stable identifier for the rule that fired (tests, analytics). */
  ruleId: string;
  venueLens: VenueLens;
  /** The pint to reach for, lower-case noun phrase: "a cold lager or cider". */
  drinkSuggestion: string;
  /** One calm sentence for the strip: "Warm and dry. Beer garden weather." */
  line: string;
};

type DrinkWeatherRule = DrinkWeatherVerdict & {
  /** Fires when true; rules are evaluated top to bottom, first match wins. */
  when: (input: DrinkWeatherInput) => boolean;
};

const RAINING_HARD_PCT = 60;
const COLD_C = 8;
const MILD_FLOOR_C = 14;
const WARM_C = 18;
const DRY_PCT = 30;
const CALM_PCT = 40;
const UNSETTLED_PCT = 50;

const SUMMER_MONTHS = new Set([6, 7, 8]);
const AUTUMN_MONTHS = new Set([9, 10, 11]);
const SPRING_MONTHS = new Set([3, 4, 5]);
const WINTER_MONTHS = new Set([12, 1, 2]);

// Order matters. Extremes first (rain and cold drive you indoors regardless of
// the calendar), then the warm-dry garden window, then winter (which claims its
// own months indoors before the riverside rule can offer a January towpath),
// then the remaining shoulder-season bands. Copy is honest: each line describes
// weather that genuinely earns the pint named. No em dashes anywhere.
export const DRINK_WEATHER_RULES: readonly DrinkWeatherRule[] = [
  {
    ruleId: "hard-rain",
    when: ({ precipitationProbabilityPct }) => precipitationProbabilityPct >= RAINING_HARD_PCT,
    venueLens: "fireplace",
    drinkSuggestion: "a stout",
    line: "Rain's set in. Stout by the fire weather.",
  },
  {
    ruleId: "cold",
    when: ({ tempC }) => tempC < COLD_C,
    venueLens: "fireplace",
    drinkSuggestion: "a stout or a dark ale",
    line: "Cold one tonight. Stout weather.",
  },
  {
    ruleId: "summer-garden",
    when: ({ tempC, precipitationProbabilityPct, month }) =>
      tempC >= WARM_C && precipitationProbabilityPct < DRY_PCT && SUMMER_MONTHS.has(month),
    venueLens: "beer-garden",
    drinkSuggestion: "a cold lager or cider",
    line: "Beer garden weather. Lager or cider.",
  },
  {
    ruleId: "warm-dry",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= WARM_C && precipitationProbabilityPct < DRY_PCT,
    venueLens: "beer-garden",
    drinkSuggestion: "a cold lager or cider",
    line: "Warm and dry. Beer garden weather.",
  },
  {
    // Winter owns its whole non-freezing, non-garden band before the riverside
    // rule can claim a January evening. London winters run dark by teatime and
    // the demand is indoors, so an 8-18C December-to-February night reads as a
    // porter regardless of how still the air is. No precipitation guard: a damp
    // winter evening still earns this verdict rather than falling through to
    // null, which is the winter gap the summer-tuned table left open. The
    // fireplace lens is the indoor signal only; it makes no venue claim, because
    // no fireplace amenity exists in the vocabulary to back one (see header).
    // "Dark early" leans on the month, not a clock: December-to-February London
    // is genuinely dark by late afternoon, so the line stays honest without
    // inventing a per-evening sunset the snapshot does not carry.
    ruleId: "winter-porter",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < WARM_C && WINTER_MONTHS.has(month),
    venueLens: "fireplace",
    drinkSuggestion: "a porter",
    line: "Winter evening, dark early. Porter weather.",
  },
  {
    ruleId: "mild-riverside",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= MILD_FLOOR_C && tempC < WARM_C && precipitationProbabilityPct < CALM_PCT,
    venueLens: "riverside",
    drinkSuggestion: "a pale ale",
    line: "Mild and calm. Riverside pint weather.",
  },
  {
    ruleId: "crisp-autumn",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < MILD_FLOOR_C && AUTUMN_MONTHS.has(month),
    venueLens: "any",
    drinkSuggestion: "an amber ale",
    line: "Crisp autumn evening. Amber ale weather.",
  },
  {
    ruleId: "cool-spring",
    when: ({ tempC, month }) => tempC >= COLD_C && tempC < MILD_FLOOR_C && SPRING_MONTHS.has(month),
    venueLens: "any",
    drinkSuggestion: "a best bitter",
    line: "Cool spring evening. Bitter weather.",
  },
  {
    ruleId: "cool-default",
    when: ({ tempC, precipitationProbabilityPct }) =>
      tempC >= COLD_C && tempC < MILD_FLOOR_C && precipitationProbabilityPct < UNSETTLED_PCT,
    venueLens: "any",
    drinkSuggestion: "a session bitter",
    line: "Cool and settled. Bitter weather.",
  },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Resolve tonight's conditions to a single verdict, or null when nothing in the
 * table fits (the caller then shows no strip). Guards its own inputs so a
 * malformed cached observation degrades to null rather than a bad suggestion.
 */
export function evaluateDrinkWeather(input: DrinkWeatherInput): DrinkWeatherVerdict | null {
  if (!isFiniteNumber(input.tempC)) return null;
  if (!isFiniteNumber(input.precipitationProbabilityPct)) return null;
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) return null;
  const match = DRINK_WEATHER_RULES.find((rule) => rule.when(input));
  if (!match) return null;
  const { when: _when, ...verdict } = match;
  void _when;
  return verdict;
}
