import { londonDayKey } from "@/lib/pintContributions";
import { londonHour } from "@/lib/londonHour";
import { NIGHT_SERVICE_END_HOUR } from "@/lib/nightServiceHours";
import { londonDateTimeInputToIso, parseLondonInput } from "@/lib/planIntake";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import placeNames from "@/lib/ask/placeNames.generated.json";
import { stripTrailingPunctuation } from "@/lib/ask/requestPolicy";
import { extractArea, FOOD_RE } from "@/lib/ask/routingPolicy";
import { refineRoutedAskQuery } from "@/lib/ask/router";

export type LateFoodQuestion = {
  area: string | null;
  at: string | null;
  dietary: string[];
  category: "pizza" | "kebab" | "cafe" | "restaurant" | null;
  additionalRequirements: string[];
  /** The clock time read from "late" or "after midnight" tonight, so the answer can name it. */
  readAs: string | null;
};

const CLOCK = /\b(?:at\s+)?(\d{1,2})(?::(\d{2})\s*([ap]m)?|\s*([ap]m))\b/gi;
const CONTEXT_AREA = /\b(?:near|in|around)\s+(.+?)(?=\s+(?:tonight|at|on|tomorrow|today|after|before|until|till|midnight|noon|midday|with|that|which|serving|for)\b|\s+\d{4}-\d{2}-\d{2}\b|\s+\d{1,2}(?::\d{2}|\s*[ap]m\b)|[?,.!;]|$)/gi;
const CONTEXT_DATE = /\b(?:on\s+)?(\d{4}-\d{2}-\d{2})\b/gi;
const CONTEXT_NIGHT = /\b(?:tonight|after\s+midnight)\b/gi;
const AFTER_MIDNIGHT = /\bafter\s+midnight\b/gi;
const TONIGHT = /\btonight\b/gi;
const LATE = /\blate(?:[- ]night)?\b/gi;
const LATE_TONIGHT_MINUTES = 23 * 60;
const AFTER_MIDNIGHT_TONIGHT_MINUTES = 60;
// Time wording the parser cannot turn into one instant. It sends the question back for a clearer time.
const VAGUE_TIME = /\b(?:(?:at\s+)?(?:midnight|noon|midday)|at\s+\d{1,2}(?:[.:]\d{2})?(?:\s*o'?clock)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:[ap]m|o'?clock)|after|before|until|till)\b/gi;
const VAGUE_DAY = /\b(?:tomorrow|today)\b/gi;
const DIETARY = /\b(?:vegan|vegetarian|gluten[- ]free)\b/gi;
const CATEGORIES = [
  [/^pizzas?$/, "pizza"], [/^kebabs?$/, "kebab"],
  [/^cafes?$/, "cafe"], [/^restaurants?$/, "restaurant"],
] as const;

function foodWording(query: string): string {
  return query.normalize("NFD").replace(/\p{M}/gu, "");
}

function recognisedArea(name: string): boolean {
  return [...placeNames.localityNames, ...NIGHT_AREAS.flatMap((area) => [area.name, area.slug, ...area.aliases])]
    .some((area) => foodWording(area).toLowerCase() === name.toLowerCase());
}

function requestedMinutes(clock: RegExpMatchArray): number | null {
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const meridiem = (clock[3] ?? clock[4])?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

function nextCalendarDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function wallTimeInput(day: string, minutes: number): string {
  return `${day}T${clockLabel(minutes)}`;
}

function londonInstant(day: string, minutes: number): string | null {
  const input = wallTimeInput(day, minutes);
  const first = londonDateTimeInputToIso(input);
  if (!first) return null;
  return londonDateTimeInputToIso(input, new Date(first)) ? null : first;
}

function requestedDay(date: string | undefined, hasNight: boolean, minutes: number | null, now: number): string | null {
  let day = date ?? null;
  if (!day && hasNight && minutes !== null) {
    const current = new Date(now);
    day = londonDayKey(current);
    if (minutes < 12 * 60 && londonHour(current) >= NIGHT_SERVICE_END_HOUR) day = nextCalendarDay(day);
  }
  return day;
}

function userTurns(recentTurns: unknown): string[] {
  if (!Array.isArray(recentTurns)) return [];
  return recentTurns.flatMap((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];
    const row = turn as { role?: unknown; content?: unknown };
    return (row.role === "user" || row.role === "assistant") && typeof row.content === "string" && row.content.trim()
      ? [{ role: row.role, content: row.content.trim().slice(0, 800) }] : [];
  }).slice(0, 6).flatMap((turn) => turn.role === "user" ? [turn.content] : []);
}

function readArea(wording: string): { area: string | null; rest: string } | null {
  const areas = [...wording.matchAll(CONTEXT_AREA)];
  if (areas.length > 1 || (areas.length === 1 && !recognisedArea(areas[0]![1]!.trim()))) return null;
  return { area: areas[0]?.[1]?.trim() ?? null, rest: wording.replace(CONTEXT_AREA, " ") };
}

function readOptionalDate(wording: string) {
  const dates = [...wording.matchAll(CONTEXT_DATE)];
  return { dates, date: dates.length === 1 ? dates[0]![1] : undefined, rest: wording.replace(CONTEXT_DATE, " ") };
}

function readTime(wording: string, dates: RegExpMatchArray[], date: string | undefined) {
  let rest = wording;
  const clocks = [...rest.matchAll(CLOCK)];
  rest = rest.replace(CLOCK, " ");
  const nights = [...rest.matchAll(CONTEXT_NIGHT)];
  rest = rest.replace(CONTEXT_NIGHT, " ");
  const tonights = nights.filter((night) => /^tonight$/i.test(night[0])).length;
  const afterMidnights = nights.length - tonights;
  const wordedTonight = clocks.length === 0 && tonights === 1 && afterMidnights <= 1;
  const lates = [...rest.matchAll(LATE)];
  if (wordedTonight) rest = rest.replace(LATE, " ");
  const wordedMinutes = !wordedTonight || lates.length > 1 ? null
    : afterMidnights === 1 ? AFTER_MIDNIGHT_TONIGHT_MINUTES
      : lates.length === 1 ? LATE_TONIGHT_MINUTES : null;
  const vague = [...rest.matchAll(VAGUE_TIME)];
  rest = rest.replace(VAGUE_TIME, " ");
  const vagueDays = [...rest.matchAll(VAGUE_DAY)];
  rest = rest.replace(VAGUE_DAY, " ");
  const minutes = clocks.length === 1 ? requestedMinutes(clocks[0]!) : wordedMinutes;
  const clearTime = dates.length <= 1 && clocks.length <= 1 && (nights.length <= 1 || wordedMinutes !== null)
    && lates.length <= 1 && vague.length === 0 && vagueDays.length === 0
    && (clocks.length > 0 || nights.length > 0)
    && !(dates.length && nights.some((night) => /^tonight$/i.test(night[0])))
    && !(clocks.length && nights.some((night) => !/^tonight$/i.test(night[0])))
    && !(clocks.length && minutes === null)
    && !(date && !parseLondonInput(wallTimeInput(date, minutes ?? 0)));
  return {
    rest,
    minutes,
    clearTime,
    readAs: wordedMinutes === null ? null : clockLabel(wordedMinutes),
    hasNight: nights.length > 0,
    hasTimeWording: dates.length + clocks.length + nights.length + lates.length + vague.length + vagueDays.length > 0,
  };
}

function readFoodRequirements(wording: string, additionalRequirements: string[]) {
  const dietary = [...wording.matchAll(DIETARY)].map((match) => match[0].toLowerCase().replace(" ", "-"));
  let rest = wording.replace(DIETARY, " ");
  const foodWords = [...rest.matchAll(new RegExp(FOOD_RE.source, "gi"))].map((match) => match[0].toLowerCase());
  const categories = [...new Set(foodWords.filter((word) => !/^(?:food|eat|eating|meals?|kitchens?)$/.test(word))
    .map((word) => CATEGORIES.find(([pattern]) => pattern.test(word))?.[1] ?? word))];
  const category = categories.length === 1 ? CATEGORIES.find(([pattern]) => pattern.test(categories[0]!))?.[1] : null;
  if (categories.length > 1 || (categories.length === 1 && !category)) return null;
  rest = rest.replace(new RegExp(FOOD_RE.source, "gi"), " ")
    .replace(/\b(?:where|what|which|can|could|would|do|does|i|we|you|me|us|my|our|want|like|need|find|get|have|recommend|suggest|show|tell|help|is|are|there|any|some|something|somewhere|anywhere|places?|options?|open|available|a|an|the|to|for|with|that|please|serving|and|or)\b/gi, " ")
    .trim();
  if (rest) additionalRequirements.unshift(rest);
  return { dietary, category: category ?? null };
}

/**
 * Read one area, one time and one optional date, then decide. A question with
 * an area but no single clear time asks for the time. A timed question with no
 * area asks for the area.
 */
export function parseLateFoodQuestion(query: string, now: number, recentTurns?: unknown): LateFoodQuestion | null {
  const [wording = "", ...additionalRequirements] = stripTrailingPunctuation(foodWording(query))
    .split(/[.!?;\n]+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (!FOOD_RE.test(wording) || !Number.isFinite(now)) return null;
  const areaFields = readArea(wording);
  if (!areaFields) return null;
  const { area } = areaFields;
  const { dates, date, rest } = readOptionalDate(areaFields.rest);
  const implicitTonight = area !== null && dates.length === 0 && [...rest.matchAll(LATE)].length === 1
    && ![CLOCK, CONTEXT_NIGHT, VAGUE_DAY, VAGUE_TIME].some((pattern) => [...rest.matchAll(pattern)].length > 0);
  const time = readTime(implicitTonight ? `${rest} tonight` : rest, dates, date);
  const requirements = readFoodRequirements(time.rest, additionalRequirements);
  if (!requirements) return null;
  if (area === null) {
    if (!time.clearTime || time.minutes === null) return null;
    const turns = userTurns(recentTurns);
    const inheritedArea = extractArea(foodWording(refineRoutedAskQuery(query, turns.at(-1), turns)));
    if (inheritedArea && recognisedArea(inheritedArea)) return null;
  } else if (!time.clearTime && !time.hasTimeWording) {
    return null;
  }
  const day = time.clearTime ? requestedDay(date, time.hasNight, time.minutes, now) : null;
  return {
    area,
    at: day !== null && time.minutes !== null ? londonInstant(day, time.minutes) : null,
    ...requirements,
    additionalRequirements,
    readAs: time.clearTime ? time.readAs : null,
  };
}

function clarificationFields(query: string): string {
  const polite = stripTrailingPunctuation(foodWording(query)).replace(/(?:\b(?:please|thanks)[\s,.!?;:]*)+$/i, "");
  const fragment = stripTrailingPunctuation(polite.trim())
    .replace(/^(?:actually|please|make\s+(?:that|it)|(?:what|how)\s+about)\b[\s,:]*/i, "");
  if (recognisedArea(fragment)) return `near ${fragment}`;
  return fragment;
}

function isFoodClarification(query: string): boolean {
  const fragment = clarificationFields(query);
  return fragment.replace(CONTEXT_AREA, " ").replace(CONTEXT_DATE, " ")
    .replace(CLOCK, " ").replace(CONTEXT_NIGHT, " ").trim().length === 0 && fragment.length > 0;
}

function correctFoodQuery(previous: string, rawFragment: string): string {
  const [request = "", ...additionalRequirements] = previous.split(/[.!?;\n]+/);
  const fragment = clarificationFields(rawFragment);
  const has = (pattern: RegExp) => [...fragment.matchAll(pattern)].length > 0;
  const area = has(CONTEXT_AREA) ? "" : request.match(CONTEXT_AREA)?.[0] ?? "";
  let query = request.replace(CONTEXT_AREA, " ");
  if (![...request.matchAll(TONIGHT)].length && parseLateFoodQuestion(previous, Date.now())?.readAs) query += " tonight";
  // "After midnight" after a question about tonight moves the time, not the night.
  const laterTonight = has(AFTER_MIDNIGHT) && !has(TONIGHT) && [...query.matchAll(TONIGHT)].length > 0;
  if (has(CLOCK) || has(AFTER_MIDNIGHT)) query = query.replace(CLOCK, " ").replace(AFTER_MIDNIGHT, " ").replace(LATE, " ").replace(VAGUE_TIME, " ");
  if (has(CONTEXT_NIGHT) && !laterTonight) query = query.replace(CONTEXT_DATE, " ").replace(TONIGHT, " ");
  if (has(CONTEXT_DATE)) query = query.replace(CONTEXT_DATE, " ").replace(/\btonight\b/gi, " ");
  if ((has(CONTEXT_NIGHT) && !laterTonight) || has(CONTEXT_DATE)) query = query.replace(VAGUE_DAY, " ");
  return [`${stripTrailingPunctuation(query)} ${area} ${fragment}`, ...additionalRequirements]
    .join(". ").replace(/\s+/g, " ").trim();
}

/** A reply in a later turn replaces only the fields it names. The merged question is checked once, as a whole. */
export function resolveLateFoodQuery(query: string, recentTurns: unknown): string {
  if (FOOD_RE.test(foodWording(query)) || !isFoodClarification(query)) return query;
  const fragments = [query];
  for (const previous of userTurns(recentTurns).reverse()) {
    if (previous === query) continue;
    if (FOOD_RE.test(foodWording(previous))) {
      if (!parseLateFoodQuestion(previous, Date.now())) return query;
      const corrected = fragments.reverse().reduce(correctFoodQuery, previous);
      return parseLateFoodQuestion(corrected, Date.now()) ? corrected : query;
    }
    if (!isFoodClarification(previous)) return query;
    fragments.push(previous);
  }
  return query;
}
