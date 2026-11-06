import { londonDayKey } from "@/lib/pintContributions";
import { londonHour } from "@/lib/londonHour";
import { NIGHT_SERVICE_END_HOUR } from "@/lib/nightServiceHours";
import { londonDateTimeInputToIso, parseLondonInput } from "@/lib/planIntake";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import placeNames from "@/lib/ask/placeNames.generated.json";
import { askRequestClauses, stripTrailingPunctuation } from "@/lib/ask/requestPolicy";
import { FOOD_RE } from "@/lib/ask/routingPolicy";

export type LateFoodQuestion = {
  areas: string[];
  at: string | null;
  dietary: string[];
  cuisines: string[];
  requiresPub: boolean;
};

const LATE_WORDS = /\b(?:late(?:[- ]night)?|after\s+midnight|midnight)\b/i;
const CLOCK = /\b(?:at\s+|(?=\d{1,2}(?::\d{2}|\s*[ap]\.?m\.?\b)))(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\b/gi;
const CONTEXT_AREA = /\b(?:near|in|around)\s+(.+?)(?=\s+(?:tonight|at|on|tomorrow|after|before|with|that|which|serving|for)\b|\s+\d{1,2}(?::\d{2}|\s*[ap]\.?m\.?\b)|\s+(?:(?:and|actually)\s+)?(?:near|in|around)\b|[?,.!;]|$)/gi;
const CONTEXT_DATE = /\bon\s+\d{4}-\d{2}-\d{2}\b/gi;
const CONTEXT_NIGHT = /\b(?:tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const AT_MIDNIGHT = /\bat midnight\b/gi;
const CUISINES = [
  [/\bpizzas?\b/i, "pizza"], [/\bkebabs?\b/i, "kebab"],
  [/\bcafes?\b/i, "cafe"], [/\brestaurants?\b/i, "restaurant"],
] as const;
// An unknown free-from requirement remains a constraint until evidence supports it.
const FOOD_CONSTRAINT = /\b(?:vegan|vegetarian|halal|kosher|pescatarian|coeliac|celiac|[a-z]+(?:-[a-z]+)*[- ]free|free\s+(?:of|from)\s+[a-z]+(?:-[a-z]+)*|(?:without|no|avoid)\s+(?:gluten|nuts?|peanuts?|dairy|milk|lactose|eggs?|soy|soya|sesame|shellfish|wheat|mustard|celery|lupin|sulphites?|sulfites?|meat|fish|seafood|cheese|butter|cream|honey|gelatine|gelatin)|allerg(?:y|ies|ic|en|ens)|intoleran(?:t|ce))\b/gi;

function foodConstraints(query: string): string[] {
  return [...foodWording(query).matchAll(FOOD_CONSTRAINT)].map((match) => match[0]);
}

function foodCategories(query: string): string[] {
  return [...new Set([...query.matchAll(new RegExp(FOOD_RE.source, "gi"))]
    .map((match) => match[0].toLowerCase())
    .filter((word) => !/^(?:food|eat|eating|meals?|kitchens?)$/.test(word))
    .map((word) => CUISINES.find(([pattern]) => pattern.test(word))?.[1] ?? word))];
}

function requiresPubKitchen(query: string): boolean {
  return /\bpubs?\b/i.test(query);
}

function foodRequestWording(query: string): string {
  return foodWording(query)
    .split(new RegExp(String.raw`(?<=[.!?])\s+(?=(?:${FOOD_RE.source.replace(/\((?!\?)/g, "(?:")}|${FOOD_CONSTRAINT.source}|${LATE_WORDS.source}))`, "i"))
    .flatMap(askRequestClauses)
    .filter((clause) => FOOD_RE.test(clause) || !/\b(?:directions|journey|transport|trains?|tube|buses?|delays?|weather|city status)\b/i.test(clause))
    .join(" ");
}

function unrecordedFoodWording(query: string): string {
  return foodRequestWording(query)
    .replace(CONTEXT_AREA, " ")
    .replace(CLOCK, " ")
    .replace(CONTEXT_DATE, " ")
    .replace(CONTEXT_NIGHT, " ")
    .replace(FOOD_CONSTRAINT, " ")
    .replace(new RegExp(FOOD_RE.source, "gi"), " ")
    .replace(/\b(?:where|what|which|can|could|would|do|does|i|we|you|me|us|my|our|want|like|need|find|get|have|recommend|suggest|show|tell|help|is|are|there|any|some|something|somewhere|anywhere|places?|options?|open|available|a|an|the|to|for|with|that|and|please|after|before|late|night|midnight|pubs?|serving|from|at|one|two|three|four)\b/gi, " ")
    .replace(/[\s,.!?;:'’\-]+/g, " ")
    .trim();
}

function requestedMinutes(query: string): number | null {
  const clocks = [...query.matchAll(CLOCK)];
  if (clocks.length === 0) return /\bat midnight\b/i.test(query) ? 0 : null;
  if (clocks.length !== 1) return null;
  const clock = clocks[0]!;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  const meridiem = clock[3]?.toLowerCase().replaceAll(".", "");
  if (minute > 59 || (!meridiem && clock[2] === undefined)) return null;
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

function wallTimeInput(day: string, minutes: number): string {
  return `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function requestedDay(query: string, minutes: number, now: number): string | null {
  const dates = [...query.matchAll(/\bon\s+(\d{4}-\d{2}-\d{2})\b/gi)];
  const tonight = /\btonight\b/i.test(query);
  if (dates.length === 1 && !tonight) {
    const day = dates[0]![1]!;
    return parseLondonInput(wallTimeInput(day, minutes)) ? day : null;
  }
  if (dates.length !== 0 || !tonight || !Number.isFinite(now)) return null;
  const date = new Date(now);
  const day = londonDayKey(date);
  // The existing service boundary owns the overnight calendar rollover.
  return minutes < 12 * 60 && londonHour(date) >= NIGHT_SERVICE_END_HOUR ? nextCalendarDay(day) : day;
}

function londonInstant(day: string, minutes: number): string | null {
  const input = wallTimeInput(day, minutes);
  const first = londonDateTimeInputToIso(input);
  if (!first) return null;
  // The shared converter rejects gaps. A second occurrence needs clarification.
  return londonDateTimeInputToIso(input, new Date(first)) ? null : first;
}

/** Explicit food timing uses service evidence rather than static pub amenities. */
export function parseLateFoodQuestion(query: string, now: number): LateFoodQuestion | null {
  const wording = foodRequestWording(query);
  if (!FOOD_RE.test(wording) || (!LATE_WORDS.test(wording) && !/\bat\b/i.test(wording) && ![...wording.matchAll(CLOCK)].length)) return null;
  const minutes = requestedMinutes(wording);
  const day = minutes === null ? null : requestedDay(wording, minutes, now);
  const at = day === null || minutes === null ? null : londonInstant(day, minutes);
  const requiresPub = requiresPubKitchen(wording);
  const areas = [...wording.matchAll(CONTEXT_AREA)]
    .map((match) => match[1]!.trim());
  const dietary = [
    [/\bvegan\b/i, "vegan"],
    [/\bvegetarian\b/i, "vegetarian"],
    [/\bgluten[- ]free\b/i, "gluten-free"],
    [/\bhalal\b/i, "halal"],
  ] as const;
  return {
    areas,
    at,
    dietary: [
      ...dietary.filter(([pattern]) => pattern.test(wording)).map(([, tag]) => tag),
      ...(foodConstraints(wording).some((constraint) => !/^(?:vegan|vegetarian|gluten[- ]free|halal)$/i.test(constraint))
        ? ["unrecorded-dietary-constraint"] : []),
    ],
    cuisines: [
      ...foodCategories(wording),
      ...(unrecordedFoodWording(wording) ? ["unrecorded-food-constraint"] : []),
    ],
    requiresPub,
  };
}

function clarificationFields(query: string): string {
  const polite = stripTrailingPunctuation(foodWording(query)).replace(/(?:\b(?:please|thanks)[\s,.!?;:]*)+$/i, "");
  const fragment = stripTrailingPunctuation(polite).replace(/^(?:actually|please|make\s+(?:that|it))\b[\s,:]*/i, "");
  if (/^\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?$/i.test(fragment)
    && requestedMinutes(`at ${fragment}`) !== null) return `at ${fragment}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fragment)) return `on ${fragment}`;
  if ([...placeNames.localityNames, ...NIGHT_AREAS.flatMap((area) => [area.name, area.slug, ...area.aliases])]
    .some((name) => name.toLowerCase() === fragment.toLowerCase())) return `near ${fragment}`;
  return fragment;
}

function foodWording(query: string): string {
  return query.normalize("NFD").replace(/\p{M}/gu, "");
}

function isFoodClarification(query: string): boolean {
  const fragment = clarificationFields(query);
  const rest = fragment
    .replace(CONTEXT_AREA, " ")
    .replace(CLOCK, " ")
    .replace(AT_MIDNIGHT, " ")
    .replace(CONTEXT_DATE, " ")
    .replace(CONTEXT_NIGHT, " ")
    .replace(FOOD_CONSTRAINT, " ")
    .replace(/\b(?:actually|please|and|make|that|it|for|me)\b/gi, " ")
    .replace(/[,.!?;:]+/g, " ")
    .trim();
  return rest.length === 0 && /[\p{L}\p{N}]/u.test(fragment);
}

function retainedFoodConstraints(query: string): string[] {
  // Area replacement cannot remove independently detected food requirements.
  const wording = foodWording(query);
  const cuisines = foodCategories(wording);
  return [...new Set([
    ...foodConstraints(wording), ...cuisines, unrecordedFoodWording(query),
    ...(requiresPubKitchen(wording) ? ["pub kitchen"] : []),
  ])].filter(Boolean);
}

function correctFoodQuery(previous: string, rawFragment: string): string {
  const fragment = clarificationFields(rawFragment);
  const priorAreas = [...previous.matchAll(CONTEXT_AREA)].map((match) => match[1]!.trim());
  const correctedAreas = [...fragment.matchAll(CONTEXT_AREA)].map((match) => match[1]!.trim());
  const areas = correctedAreas.length ? correctedAreas : priorAreas;
  let query = previous.replace(CONTEXT_AREA, " ");
  if ([...fragment.matchAll(CLOCK)].length || /\bat midnight\b/i.test(fragment)) {
    query = query.replace(CLOCK, " ").replace(AT_MIDNIGHT, " ");
  }
  if ([...fragment.matchAll(CONTEXT_DATE)].length || [...fragment.matchAll(CONTEXT_NIGHT)].length) {
    query = query.replace(CONTEXT_DATE, " ").replace(CONTEXT_NIGHT, " ");
  }
  const correction = fragment.replace(CONTEXT_AREA, " ");
  return [query, correction, ...retainedFoodConstraints(previous), ...areas.map((area) => `near ${area}`)].join(" ").replace(/\s+/g, " ").trim();
}

/** Complete a field-only reply from recent user food context. A new topic ends it. */
export function resolveLateFoodQuery(query: string, recentTurns: unknown): string {
  if (FOOD_RE.test(foodWording(query)) || !isFoodClarification(query) || !Array.isArray(recentTurns)) return query;
  const users = recentTurns.flatMap((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];
    const row = turn as { role?: unknown; content?: unknown };
    return row.role === "user" && typeof row.content === "string" && row.content.trim()
      ? [row.content.trim().slice(0, 800)] : [];
  }).slice(-6);
  const fragments = [query];
  for (const previous of users.reverse()) {
    if (previous === query) continue;
    if (FOOD_RE.test(foodWording(previous))) {
      return fragments.reverse().reduce(correctFoodQuery, previous);
    }
    if (!isFoodClarification(previous)) return query;
    fragments.push(previous);
  }
  return query;
}
