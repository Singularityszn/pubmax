import { londonDayKey } from "@/lib/pintContributions";
import { londonHour } from "@/lib/londonHour";
import { NIGHT_SERVICE_END_HOUR } from "@/lib/nightServiceHours";
import { londonDateTimeInputToIso, parseLondonInput } from "@/lib/planIntake";

export type LateFoodQuestion = {
  areas: string[];
  at: string | null;
  dietary: string[];
  cuisine: string | null;
  requiresPub: boolean;
};

const FOOD_WORDS = /\b(?:food|eat|eating|meals?|lunch|dinner|supper|snacks?|restaurants?|pizzas?|kebabs?|cafes?|kitchens?)\b/i;
const LATE_WORDS = /\b(?:late(?:[- ]night)?|after\s+midnight|midnight)\b/i;
const CLOCK = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\b/gi;
// An unknown free-from requirement remains a constraint until evidence supports it.
const FOOD_CONSTRAINT = /\b(?:vegan|vegetarian|halal|kosher|pescatarian|coeliac|celiac|[a-z]+(?:-[a-z]+)*[- ]free|free\s+(?:of|from)\s+[a-z]+(?:-[a-z]+)*|(?:without|no|avoid)\s+(?:gluten|nuts?|peanuts?|dairy|milk|lactose|eggs?|soy|soya|sesame|shellfish|wheat|mustard|celery|lupin|sulphites?|sulfites?|meat|fish|seafood|cheese|butter|cream|honey|gelatine|gelatin)|allerg(?:y|ies|ic|en|ens)|intoleran(?:t|ce))\b/gi;

function foodConstraints(query: string): string[] {
  return [...foodWording(query).matchAll(FOOD_CONSTRAINT)].map((match) => match[0]);
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
  const wording = query.normalize("NFD").replace(/\p{M}/gu, "");
  if (!FOOD_WORDS.test(wording) || (!LATE_WORDS.test(wording) && ![...query.matchAll(CLOCK)].length)) return null;
  const minutes = requestedMinutes(query);
  const day = minutes === null ? null : requestedDay(query, minutes, now);
  const at = day === null || minutes === null ? null : londonInstant(day, minutes);
  const requiresPub = /\bpubs?\b/i.test(wording);
  // Daytime pub/lunch discovery keeps its existing route. A standalone timed
  // food-service request still needs evidence, including a 06:00 request.
  if (!LATE_WORDS.test(wording) && (requiresPub || /\blunch\b/i.test(wording))
    && at && londonHour(new Date(at)) >= NIGHT_SERVICE_END_HOUR) return null;
  const areas = [...query.matchAll(/\b(?:near|in|around)\s+(.+?)(?=\s+(?:tonight|at|on|tomorrow|after|before)\b|\s+(?:(?:and|actually)\s+)?(?:near|in|around)\b|[?,.!;]|$)/gi)]
    .map((match) => match[1]!.trim());
  const dietary = [
    [/\bvegan\b/i, "vegan"],
    [/\bvegetarian\b/i, "vegetarian"],
    [/\bgluten[- ]free\b/i, "gluten-free"],
    [/\bhalal\b/i, "halal"],
  ] as const;
  const cuisines = [
    [/\bpizzas?\b/i, "pizza"], [/\bkebabs?\b/i, "kebab"],
    [/\bcafes?\b/i, "cafe"], [/\brestaurants?\b/i, "restaurant"],
  ] as const;
  return {
    areas,
    at,
    dietary: [
      ...dietary.filter(([pattern]) => pattern.test(wording)).map(([, tag]) => tag),
      ...(foodConstraints(wording).some((constraint) => !/^(?:vegan|vegetarian|gluten[- ]free|halal)$/i.test(constraint))
        ? ["unrecorded-dietary-constraint"] : []),
    ],
    cuisine: cuisines.find(([pattern]) => pattern.test(wording))?.[1] ?? null,
    requiresPub,
  };
}

const CONTEXT_AREA = /\b(?:near|in|around)\s+(.+?)(?=\s+(?:tonight|at|on|tomorrow|after|before)\b|\s+(?:(?:and|actually)\s+)?(?:near|in|around)\b|[?,.!;]|$)/gi;
const CONTEXT_DATE = /\bon\s+\d{4}-\d{2}-\d{2}\b/gi;
const CONTEXT_NIGHT = /\b(?:tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const AT_MIDNIGHT = /\bat midnight\b/gi;
const BARE_MERIDIEM_CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)$/i;

function clarificationClock(query: string): string {
  const match = query.trim().match(BARE_MERIDIEM_CLOCK);
  if (!match) return query;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  return hour >= 1 && hour <= 12 && minute < 60 ? `at ${query.trim()}` : query;
}

function foodWording(query: string): string {
  return query.normalize("NFD").replace(/\p{M}/gu, "");
}

function isFoodClarification(query: string): boolean {
  const rest = foodWording(clarificationClock(query))
    .replace(CONTEXT_AREA, " ")
    .replace(CLOCK, " ")
    .replace(AT_MIDNIGHT, " ")
    .replace(CONTEXT_DATE, " ")
    .replace(CONTEXT_NIGHT, " ")
    .replace(FOOD_CONSTRAINT, " ")
    .replace(/\b(?:actually|please|and|make|that|it|for|me)\b/gi, " ")
    .replace(/[,.!?;:]+/g, " ")
    .trim();
  return rest.length === 0 && /[\p{L}\p{N}]/u.test(query);
}

function retainedFoodConstraints(query: string): string[] {
  // Area replacement cannot remove independently detected food requirements.
  const wording = foodWording(query);
  const cuisineAndPub = [...wording.matchAll(/\b(?:pizzas?|kebabs?|cafes?|restaurants?|pubs?)\b/gi)].map((match) => match[0]);
  return [...new Set([...foodConstraints(wording), ...cuisineAndPub])];
}

function correctFoodQuery(previous: string, rawFragment: string): string {
  const fragment = clarificationClock(rawFragment.replace(/^(?:actually|please|make\s+(?:that|it))\b[\s,:]*/i, ""));
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
  if (FOOD_WORDS.test(foodWording(query)) || !isFoodClarification(query) || !Array.isArray(recentTurns)) return query;
  const users = recentTurns.flatMap((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return [];
    const row = turn as { role?: unknown; content?: unknown };
    return row.role === "user" && typeof row.content === "string" && row.content.trim()
      ? [row.content.trim().slice(0, 800)] : [];
  }).slice(-6);
  const fragments = [query];
  for (const previous of users.reverse()) {
    if (previous === query) continue;
    if (FOOD_WORDS.test(foodWording(previous))) {
      return fragments.reverse().reduce(correctFoodQuery, previous);
    }
    if (!isFoodClarification(previous)) return query;
    fragments.push(previous);
  }
  return query;
}
