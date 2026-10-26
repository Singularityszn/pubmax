// Concierge intent policy: candidate finders, probability guards, and the
// composition of TypeSafe answers into a ConciergeIntent.
//
// Thresholds are cited from
// __tests__/fixtures/typesafe/conciergeIntentProbabilities.json

import { CONCIERGE_MOODS, type ConciergeIntent, type ConciergeMood } from "@/lib/concierge/rank";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { isKnownAskPlacePhrase } from "@/lib/ask/placePhrases";
import { LONDON_BOROUGHS } from "@/lib/boroughs";

/** Keyless cheap-pint cap. Same figure the regex path has always used. */
export const CHEAP_PINT_GBP = 6;

/** Keyless default when the request does not name a group. */
export const DEFAULT_GROUP_SIZE = 2;

export const AREA_NONE = "none";
export const GROUP_UNSTATED = "unstated";
export const BUDGET_EXPLICIT = "explicit figure";
export const BUDGET_CHEAP = "cheap";
export const BUDGET_UNSTATED = "unstated";

export const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

/**
 * Mood Noul floor. A Noul of 0.5 is unsure, not a medium yes. Cited from
 * __tests__/fixtures/typesafe/conciergeIntentProbabilities.json
 */
export const CONCIERGE_MOOD_NOUL_THRESHOLD = 0.63;

/**
 * Choice floor. An argmax of 0.13 on a three-way Choice is not a decision.
 * Cited from __tests__/fixtures/typesafe/conciergeIntentProbabilities.json
 */
export const CONCIERGE_CHOICE_FLOOR = 0.55;

/** A judged answer is only a probability when it is a real number in [0, 1]. */
export function isConciergeProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function defaultKnownAreas(): string[] {
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const area of NIGHT_AREAS) {
    for (const label of [area.name, ...area.aliases]) {
      const trimmed = label.trim();
      const key = trimmed.toLocaleLowerCase("en-GB");
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      areas.push(trimmed);
    }
  }
  return areas;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholePhraseInText(text: string, phrase: string): boolean {
  const needle = phrase.trim();
  if (!needle) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "iu");
  return pattern.test(text);
}

/** Area phrase the regex path already extracts. Shared so candidates match it. */
function extractAreaPhrase(text: string): string | undefined {
  const areaMatch = text.match(
    /\b(?:near|around|in)\s+([\p{L}][\p{L}' .-]*?)(?=\s+(?:for|with|under|below|max|not)\b|\s*,|[.!?]|$)/iu,
  );
  const area = areaMatch?.[1]?.trim().replace(/\s+/g, " ");
  return area || undefined;
}

/**
 * A cap word before a figure: "under", "below", "max", "up to". Alone it says
 * nothing about money: "under 10 minutes", "max 4 pubs" and "up to 8 of us"
 * all carry one, so every budget pattern below also needs a currency word.
 */
const BUDGET_CAP = String.raw`\b(?:under|below|max(?:imum)?|up to)`;
const BUDGET_FIGURE = String.raw`(\d+(?:\.\d{1,2})?)`;
/** A unit after the figure that makes it a count, a time or a distance. */
const NOT_MONEY_UNIT = String.raw`(?!\.?\d|\s*(?:min|mins|minutes?|hours?|hrs?|km|kms|miles?|stops?|pubs?|bars?|people|mates|pax|of us)\b)`;
/** A currency word after the figure: "7 quid", "6 pounds", "6 a pint". */
const MONEY_AFTER = String.raw`\s*(?:quid|pounds?|gbp|(?:a|per)\s+pint)\b`;

const BUDGET_PATTERNS: readonly RegExp[] = [
  // "under £7", "max £5", "up to £6.50"
  new RegExp(`${BUDGET_CAP}\\s*£\\s*${BUDGET_FIGURE}${NOT_MONEY_UNIT}`, "i"),
  // "under 7 quid", "below 6 pounds", "max 6 a pint"
  new RegExp(`${BUDGET_CAP}\\s*${BUDGET_FIGURE}${MONEY_AFTER}`, "i"),
  // "£6 or less", "£6 max"
  new RegExp(`£\\s*${BUDGET_FIGURE}\\s*(?:or less|max)\\b`, "i"),
  // "6 quid or less", "6 quid max"
  new RegExp(`${BUDGET_FIGURE}\\s*(?:quid|pounds?)\\s*(?:or less|max)\\b`, "i"),
];

export function extractExplicitBudget(text: string): number | undefined {
  let explicitBudget: string | undefined;
  for (const pattern of BUDGET_PATTERNS) {
    explicitBudget = text.match(pattern)?.[1];
    if (explicitBudget) break;
  }
  if (!explicitBudget) return undefined;
  const n = Number(explicitBudget);
  if (!Number.isFinite(n)) return undefined;
  // A positive human ceiling must not rise to the model's lower bound.
  if (n > 0 && n < 3) return n;
  return Math.min(15, Math.max(3, n));
}

const CARDINAL_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)";
const CARDINAL_TOKEN = `(?:\\d+(?:[.,/]\\d+)*|${CARDINAL_WORD})`;
const CARDINAL_PHRASE = `${CARDINAL_TOKEN}(?:[-\\s]+(?:(?:and|or|to)[-\\s]+)?(?:${CARDINAL_TOKEN}|a[-\\s]+half))*`;
const QUANTITY_UNIT = "(?:us|people|persons?|friends?|mates?|guys|adults|pax|am|pm|o['’]clock|hours?|hrs?|minutes?|mins?|pounds?|quid|pence|gbp)";
const COUNT_GAP_STOP = `(?:${CARDINAL_WORD}|${QUANTITY_UNIT}|each|per|in|at|near|around|by|with|for|from|to|then|but|not|than|stops?|pubs?|bars?|venues?|places?)\\b`;
const VENUE_QUANTITY_RE = new RegExp(
  `(?<![£$€]\\s*|\\d[.,/])\\b(${CARDINAL_PHRASE})(?=[-\\s]+(?:(?!${COUNT_GAP_STOP})[a-z][a-z'’]*[-\\s]+)*(?:stops?|pubs?|bars?|venues?|places?)\\b)`,
  "gi",
);
const PARTY_NUMBER = `(?:[1-9]|1\\d|20|${Object.keys(NUMBER_WORDS).join("|")})`;
const PARTY_NUMBER_START = `(?<![a-z0-9][-.,/]|[£$€]\\s*|\\b${CARDINAL_TOKEN}[-\\s]+(?:(?:and|or|to)[-\\s]+)?)`;
const PARTY_NUMBER_END = `(?![-\\s]+(?:(?:and|or|to)[-\\s]+)?(?:${CARDINAL_TOKEN}|a[-\\s]+half|more)\\b|[.,/]\\d)`;
const PARTY_QUANTITY = `[£$€]\\s*${CARDINAL_PHRASE}|\\b${CARDINAL_PHRASE}[-\\s]*(?:am|pm|o['’]clock|hours?|hrs?|minutes?|mins?|pounds?|quid|pence|gbp|(?:a|per)\\s+pint)\\b|${PARTY_NUMBER_START}\\b${PARTY_NUMBER}\\s+(?:of us|people|mates|pax)\\b|\\b(?:for|group of)\\s+${PARTY_NUMBER}\\b${PARTY_NUMBER_END}`;
const PARTY_QUANTITY_RE = new RegExp(PARTY_QUANTITY, "gi");
const OWNED_QUANTITY_RE = new RegExp(
  `${PARTY_QUANTITY}|\\b(?:a|an|the)[-\\s]+(?:(?!${CARDINAL_WORD}\\b)[a-z'’]+[-\\s]+)?one\\b`,
  "gi",
);
const BARE_CARDINAL_RE = new RegExp(`\\b${CARDINAL_TOKEN}\\b`, "i");
const RELATIVE_QUANTITY_RE = /\b(?:another|more)\b/i;
const UNSTATED_QUANTITY_RE = new RegExp(`\\ban?[-\\s]+(?:(?!${COUNT_GAP_STOP})[a-z][a-z'’]*[-\\s]+)+(?:stops|pubs|bars|venues|places)\\b`, "i");

export const SAME_AREA_REFERENCE_RE = /(?:\b(?:in|near|around)\s+)?\b(?:the\s+)?same\s+(?:area|patch|neighbou?rhood)\b/i;

export function isSupportedAskArea(area: string): boolean {
  const key = area.toLocaleLowerCase("en-GB");
  return key === "london"
    || defaultKnownAreas().some((label) => label.toLocaleLowerCase("en-GB") === key)
    || LONDON_BOROUGHS.some((label) => label.toLocaleLowerCase("en-GB") === key)
    || isKnownAskPlacePhrase(area);
}

const CONSUMED_REQUEST_PHRASE_RE = /\b(?:pub[\s-]+crawls?|for a quick one(?: after work)?|to save money|(?:show|give|include)(?: me| us)?(?: the)? (?:(?:source|recorded) dates?|sources?)|(?:(?:(?:them|it) )?on )?(?:the|a) map|not pricey|low-key|live(?=[\s-]+sports?\b))\b/gi;
const VENUE_NOUN_RE = /\b(?:pubs?|bars?|stops?|venues?|places?)\b/gi;
const CONSUMED_REQUEST_WORDS = new Set("a an the and or but with for in near nearby around at of to then that across please find show me us plan sort get give list recommend suggest what s is are where some any how much do does crawl crawls night out route cheap cheaper cheapest price prices cost costs pint pints beer beers drink drinks under below max maximum up less per listed recorded best value lowest affordable good decent nice local tonight now right later today this evening afternoon morning weekend am pm people friends mates group quiet ish calm lively buzzing cosy cozy snug fireside garden outdoor riverside waterside sports romantic historic food meal dinner menu options cocktail cocktails".split(" "));
const UNSUPPORTED_REQUEST_WORDS = "craft cider gardens lunch breakfast wine wines spirit spirits coffee whisky whiskey gin rum vodka shot shots soft low key live music meals".split(" ");

const VENUE_NAME_WORD = String.raw`(?!(?:${[...CONSUMED_REQUEST_WORDS, ...UNSUPPORTED_REQUEST_WORDS].join("|")})\b)[\p{L}][\p{L}'’-]*`;
const VENUE_NAME_RUN = String.raw`${VENUE_NAME_WORD}(?:\s+${VENUE_NAME_WORD})*`;
const NAMED_VENUE_RE = new RegExp(String.raw`\bat\s+(?:the\s+)?${VENUE_NAME_RUN}(?:\s+(?:and|&|of)\s+(?:the\s+)?${VENUE_NAME_RUN})?`, "giu");
const AREA_REFERENCE_RE = new RegExp(String.raw`(?:,?\s*\bnot\s+)?(?:${SAME_AREA_REFERENCE_RE.source})`, "gi");

export function withoutSameAreaReference(text: string): string {
  return text.replace(AREA_REFERENCE_RE, " ");
}

/**
 * `venueName` is a caller's validated venue binding. Left undefined, any run of
 * non-request words after "at" reads as a name, which only a preliminary check
 * may accept. A string consumes exactly that name, before the area so a pub
 * named after one stays whole. Null consumes no name at all.
 */
export function isCompleteLocalRequest(text: string, itemWords: readonly string[] = [], venueName?: string | null): boolean {
  let rest = withoutSameAreaReference(withoutExcludedPlaces(text));
  if (venueName) rest = rest.replace(new RegExp(String.raw`\bat\s+${escapeRegExp(venueName)}(?![\p{L}\p{N}])`, "giu"), " at ");
  const area = deterministicAreaInText(rest, defaultKnownAreas());
  if (area && isSupportedAskArea(area)) rest = rest.replace(new RegExp(`\\b${escapeRegExp(area)}\\b`, "giu"), " ");
  let venueNouns = 0;
  rest = (venueName === undefined ? rest.replace(NAMED_VENUE_RE, " at ") : rest).replace(CONSUMED_REQUEST_PHRASE_RE, " ")
    .replace(VENUE_QUANTITY_RE, " ")
    .replace(PARTY_QUANTITY_RE, " ")
    .replace(VENUE_NOUN_RE, () => { venueNouns += 1; return " "; });
  const item = new Set(itemWords.flatMap((word) => word.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  return venueNouns <= 1 && (rest.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).every((word) => CONSUMED_REQUEST_WORDS.has(word) || item.has(word));
}

export function requestedVenueQuantity(query: string): number | null | undefined {
  if (RELATIVE_QUANTITY_RE.test(query) || UNSTATED_QUANTITY_RE.test(query)) return null;
  const counts: string[] = [];
  const unclaimed = query.replace(VENUE_QUANTITY_RE, (_phrase: string, count: string) => {
    counts.push(count.toLowerCase());
    return " ";
  });
  if (/\b[a-z]+-(?:stops?|pubs?|bars?|venues?|places?)\b/i.test(unclaimed) || BARE_CARDINAL_RE.test(unclaimed.replace(OWNED_QUANTITY_RE, " "))) return null;
  if (counts.length !== 1) return counts.length === 0 ? undefined : null;
  const count = NUMBER_WORDS[counts[0]!] ?? Number(counts[0]);
  return Number.isInteger(count) && count > 0 && isCompleteLocalRequest(query) ? count : null;
}

/** A preposition directly before an area: "in Shoreditch", "near Soho". */
const AREA_PREPOSITION_BEFORE = /\b(?:in|near|around|at)\s+$/iu;

const EXCLUDED_PLACE_RE = /,?\s*\b(?:but\s+)?not\s+(?:in|near|around)\s+((?:(?!\s+(?:but\s+)?not\s+(?:in|near|around)\b)[^,.!?;])+)/giu;

function excludedPlaceClause(match: string, place: string): string {
  const ends = [...place.matchAll(/\S+/gu)].map((word) => word.index + word[0].length);
  const end = ends.slice(1).reverse().find((length) => isSupportedAskArea(place.slice(0, length))) ?? ends[0] ?? 0;
  return match.slice(0, match.length - place.length + end);
}

/** An excluded place ("not in Soho") is never the place the ask is about. */
export function withoutExcludedPlaces(text: string): string {
  return text.replace(EXCLUDED_PLACE_RE, (match: string, place: string) => match.slice(excludedPlaceClause(match, place).length).replace(/^\s+but(?=\s+(?:in|near|around)\b)/iu, ""));
}

export function namesExcludedPlace(text: string, place: string): boolean {
  return [...text.matchAll(EXCLUDED_PLACE_RE)].some((match) => wholePhraseInText(excludedPlaceClause(match[0], match[1]!), place));
}

/**
 * Nouns a bare area names a night out with: "a Shoreditch crawl", "Soho pubs",
 * "a Shoreditch pub-crawl". A singular "pub" or "bar" is left out, because
 * "the Angel pub" names a venue, not the area.
 */
const AREA_NIGHT_NOUNS = /^\s+(?:pub[\s-]+crawls?|crawls?|pubs|bars|drinks|pints?)\b/iu;

/**
 * Longer London place names that start with a known area's word but are not
 * that area: "in Victoria Park" is not Victoria.
 */
const PLACES_THAT_ARE_NOT_KNOWN_AREAS = [
  "Victoria Park",
  "Camden Passage",
  "Richmond Park",
  "Greenwich Park",
  "Clapham Common Road",
  "Angel Islington",
] as const;

/**
 * The area a keyless parse plans in. A known area named after "in", "near",
 * "around" or "at" wins, so "in Shoreditch tonight" is Shoreditch. So does a
 * request that is only the area's name, and a known area directly before a
 * night-out noun, so "a Shoreditch crawl" is Shoreditch. At each position the
 * longest label named there is read, in any case, so "in Camden Town" is
 * Camden Town and "in victoria park" is the place, not Victoria. The first
 * area named wins. A known area named anywhere else is not read as the area:
 * "a crawl along the Victoria line" plans across London.
 */
export function deterministicAreaInText(
  text: string,
  knownAreas: readonly string[],
): string | undefined {
  const positive = withoutExcludedPlaces(text);
  const known = firstKnownAreaNamedIn(positive, knownAreas);
  const phrase = extractAreaPhrase(positive);
  return known && !(phrase && isKnownAskPlacePhrase(phrase) && phrase.toLowerCase().startsWith(`${known.toLowerCase()} `)) ? known : phrase;
}

function firstKnownAreaNamedIn(
  text: string,
  knownAreas: readonly string[],
): string | undefined {
  const longestAt = new Map<number, { label: string; known: boolean }>();
  const labels = [
    ...knownAreas.map((label) => ({ label: label.trim(), known: true })),
    ...PLACES_THAT_ARE_NOT_KNOWN_AREAS.map((label) => ({ label, known: false })),
  ];
  for (const { label, known } of labels) {
    if (!label) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(label)}\\b`, "giu");
    for (const match of text.matchAll(pattern)) {
      const current = longestAt.get(match.index);
      if (!current || label.length > current.label.length) {
        longestAt.set(match.index, { label, known });
      }
    }
  }
  const whole = text.trim().replace(/[.!?]+$/u, "").trim().toLocaleLowerCase("en-GB");
  for (const [index, { label, known }] of [...longestAt].sort(([a], [b]) => a - b)) {
    if (!known) continue;
    const after = text.slice(index + label.length);
    if (
      whole === label.toLocaleLowerCase("en-GB")
      || AREA_NIGHT_NOUNS.test(after)
      || AREA_PREPOSITION_BEFORE.test(text.slice(0, index))
    ) {
      return label;
    }
  }
  return undefined;
}

/**
 * Known-area labels that appear as whole phrases in the request, plus any
 * lookahead-extracted phrase the regex path would have kept. Longest first so
 * "King's Cross" wins over a shorter neighbour.
 */
export function areaCandidatesInText(text: string, knownAreas: readonly string[]): string[] {
  text = withoutExcludedPlaces(text);
  const hits: string[] = [];
  const seen = new Set<string>();
  const sorted = [...knownAreas].sort((a, b) => b.length - a.length);
  for (const area of sorted) {
    const trimmed = area.trim();
    const key = trimmed.toLocaleLowerCase("en-GB");
    if (!trimmed || seen.has(key)) continue;
    if (!wholePhraseInText(text, trimmed)) continue;
    seen.add(key);
    hits.push(trimmed);
  }
  const extracted = extractAreaPhrase(text);
  if (extracted) {
    const key = extracted.toLocaleLowerCase("en-GB");
    if (!seen.has(key)) {
      seen.add(key);
      hits.push(extracted);
    }
  }
  return hits;
}

/**
 * Group-size numbers that appear in the request. Pint-price figures are
 * stripped first so "under £7" cannot become a table of seven.
 */
export function groupSizeCandidatesInText(text: string): string[] {
  const withoutPrices = text
    .replace(/£\s*\d+(?:\.\d{1,2})?/g, " ")
    .replace(/(?:under|below|max(?:imum)?|up to)\s*£?\s*\d+(?:\.\d{1,2})?/gi, " ");
  const found = new Set<string>();
  for (const match of withoutPrices.matchAll(/\b(\d{1,2})\b/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 20) found.add(String(n));
  }
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(withoutPrices)) found.add(String(n));
  }
  return [...found];
}

export function moodQuestionId(mood: ConciergeMood): string {
  return `mood_${mood}`;
}

function choiceProbability(
  probabilities: Record<string, unknown> | undefined,
  label: string,
): unknown {
  if (!probabilities || typeof probabilities !== "object") return undefined;
  return probabilities[label];
}

export function moodsFromNouls(
  nouls: Partial<Record<ConciergeMood, unknown>>,
): ConciergeMood[] | null {
  const mood: ConciergeMood[] = [];
  for (const candidate of CONCIERGE_MOODS) {
    const value = nouls[candidate];
    if (!isConciergeProbability(value)) return null;
    if (value >= CONCIERGE_MOOD_NOUL_THRESHOLD) mood.push(candidate);
  }
  return mood;
}

function pickedChoice(
  choice: unknown,
  probabilities: Record<string, unknown> | undefined,
  allowed: readonly string[],
): string | null {
  if (typeof choice !== "string" || !allowed.includes(choice)) return null;
  const probability = choiceProbability(probabilities, choice);
  if (!isConciergeProbability(probability)) return null;
  if (probability < CONCIERGE_CHOICE_FLOOR) return null;
  return choice;
}

/**
 * Areas are factual strings, not creative output: require a verbatim phrase
 * from the user's request so the model cannot relocate the crew.
 */
export function areaVerbatimInText(originalText: string, area: string): boolean {
  const needle = area.trim();
  if (!needle) return false;
  return withoutExcludedPlaces(originalText).toLocaleLowerCase("en-GB").includes(needle.toLocaleLowerCase("en-GB"));
}

export type ConciergeJudgmentAnswers = {
  moods: Partial<Record<ConciergeMood, unknown>>;
  areaChoice: unknown;
  areaProbabilities?: Record<string, unknown>;
  groupChoice: unknown;
  groupProbabilities?: Record<string, unknown>;
  budgetChoice: unknown;
  budgetProbabilities?: Record<string, unknown>;
  areaOptions: readonly string[];
  groupOptions: readonly string[];
};

/**
 * Compose a ConciergeIntent from typed TypeSafe answers. Returns null when any
 * required probability is missing or not in [0, 1], so the caller keeps the
 * deterministic fallback instead of comparing a coerced string.
 */
export function intentFromJudgment(
  originalText: string,
  answers: ConciergeJudgmentAnswers,
): ConciergeIntent | null {
  const mood = moodsFromNouls(answers.moods);
  if (!mood) return null;

  if (typeof answers.areaChoice === "string" && answers.areaChoice !== AREA_NONE) {
    const raw = choiceProbability(answers.areaProbabilities, answers.areaChoice);
    if (raw !== undefined && !isConciergeProbability(raw)) return null;
    if (!areaVerbatimInText(originalText, answers.areaChoice)) return null;
  }

  const areaOptions = [...answers.areaOptions, AREA_NONE];
  const pickedArea = pickedChoice(answers.areaChoice, answers.areaProbabilities, areaOptions);
  const area = pickedArea && pickedArea !== AREA_NONE ? pickedArea.trim() : undefined;

  if (typeof answers.groupChoice === "string" && answers.groupChoice !== GROUP_UNSTATED) {
    const raw = choiceProbability(answers.groupProbabilities, answers.groupChoice);
    if (raw !== undefined && !isConciergeProbability(raw)) return null;
  }
  const groupOptions = [...answers.groupOptions, GROUP_UNSTATED];
  const pickedGroup = pickedChoice(answers.groupChoice, answers.groupProbabilities, groupOptions);
  let groupSize = DEFAULT_GROUP_SIZE;
  if (pickedGroup && pickedGroup !== GROUP_UNSTATED) {
    const parsed = Number(pickedGroup);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
    groupSize = parsed;
  }

  if (typeof answers.budgetChoice === "string" && answers.budgetChoice !== BUDGET_UNSTATED) {
    const raw = choiceProbability(answers.budgetProbabilities, answers.budgetChoice);
    if (raw !== undefined && !isConciergeProbability(raw)) return null;
  }
  const budgetOptions = [BUDGET_EXPLICIT, BUDGET_CHEAP, BUDGET_UNSTATED];
  const pickedBudget = pickedChoice(answers.budgetChoice, answers.budgetProbabilities, budgetOptions);
  let maxPintPrice: number | undefined;
  if (pickedBudget === BUDGET_EXPLICIT) {
    maxPintPrice = extractExplicitBudget(originalText);
  } else if (pickedBudget === BUDGET_CHEAP) {
    maxPintPrice = CHEAP_PINT_GBP;
  }

  return {
    mood,
    groupSize,
    ...(area ? { area } : {}),
    ...(maxPintPrice !== undefined ? { maxPintPrice } : {}),
  };
}

export function validateJudgedIntent(value: unknown, originalText: string): ConciergeIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mood = record.mood;
  if (!Array.isArray(mood) || !mood.every((item) => typeof item === "string" && CONCIERGE_MOODS.includes(item as ConciergeMood))) {
    return null;
  }
  const groupSize = record.groupSize;
  if (typeof groupSize !== "number" || !Number.isInteger(groupSize) || groupSize < 1 || groupSize > 20) {
    return null;
  }
  const area = record.area;
  if (area !== undefined) {
    if (typeof area !== "string" || !area.trim() || area.length > 80) return null;
    if (!areaVerbatimInText(originalText, area)) return null;
  }
  const maxPintPrice = record.maxPintPrice;
  if (
    maxPintPrice !== undefined
    && (typeof maxPintPrice !== "number" || !Number.isFinite(maxPintPrice) || maxPintPrice < 3 || maxPintPrice > 15)
  ) {
    return null;
  }

  return {
    mood: [...new Set(mood as ConciergeMood[])],
    groupSize,
    ...(typeof area === "string" ? { area: area.trim() } : {}),
    ...(typeof maxPintPrice === "number" ? { maxPintPrice } : {}),
  };
}
