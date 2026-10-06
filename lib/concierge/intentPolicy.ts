// Concierge intent policy: candidate finders, probability guards, and the
// composition of TypeSafe answers into a ConciergeIntent.
//
// Thresholds are cited from
// __tests__/fixtures/typesafe/conciergeIntentProbabilities.json

import { CONCIERGE_MOODS, type ConciergeIntent, type ConciergeMood } from "@/lib/concierge/rank";
import { NIGHT_AREAS } from "@/lib/nightAreas";

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

export function extractExplicitBudget(text: string): number | undefined {
  const explicitBudget =
    text.match(/(?:under|below|max(?:imum)?|up to)\s*£?\s*(\d+(?:\.\d{1,2})?)/i)?.[1]
    ?? text.match(/£\s*(\d+(?:\.\d{1,2})?)\s*(?:or less|max)/i)?.[1];
  if (!explicitBudget) return undefined;
  const n = Number(explicitBudget);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(15, Math.max(3, n));
}

/** A preposition directly before an area: "in Shoreditch", "near Soho". */
const AREA_PREPOSITION_BEFORE = /\b(?:in|near|around|at)\s+$/iu;

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
  return firstKnownAreaNamedIn(text, knownAreas) ?? extractAreaPhrase(text);
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
  return originalText.toLocaleLowerCase("en-GB").includes(needle.toLocaleLowerCase("en-GB"));
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
