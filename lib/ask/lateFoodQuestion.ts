import { londonDayKey } from "@/lib/pintContributions";
import { londonHour } from "@/lib/londonHour";
import { NIGHT_SERVICE_END_HOUR } from "@/lib/nightServiceHours";
import { londonDateTimeInputToIso, parseLondonInput } from "@/lib/planIntake";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import placeNames from "@/lib/ask/placeNames.generated.json";
import { stripTrailingPunctuation } from "@/lib/ask/requestPolicy";
import { FOOD_RE } from "@/lib/ask/routingPolicy";

export type LateFoodQuestion = {
  area: string;
  at: string | null;
  dietary: string[];
  category: "pizza" | "kebab" | "cafe" | "restaurant" | null;
};

const CLOCK = /\b(?:at\s+)?(\d{1,2})(?::(\d{2})\s*([ap]m)?|\s*([ap]m))\b/gi;
const CONTEXT_AREA = /\b(?:near|in|around)\s+(.+?)(?=\s+(?:tonight|at|on|tomorrow|after|before|with|that|which|serving|for)\b|\s+\d{1,2}(?::\d{2}|\s*[ap]m\b)|[?,.!;]|$)/gi;
const CONTEXT_DATE = /\b(?:on\s+)?(\d{4}-\d{2}-\d{2})\b/gi;
const CONTEXT_NIGHT = /\b(?:tonight|after\s+midnight)\b/gi;
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

function wallTimeInput(day: string, minutes: number): string {
  return `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function londonInstant(day: string, minutes: number): string | null {
  const input = wallTimeInput(day, minutes);
  const first = londonDateTimeInputToIso(input);
  if (!first) return null;
  return londonDateTimeInputToIso(input, new Date(first)) ? null : first;
}

export function parseLateFoodQuestion(query: string, now: number): LateFoodQuestion | null {
  const wording = stripTrailingPunctuation(foodWording(query));
  if (!FOOD_RE.test(wording) || /[.!?;\n]/.test(wording) || !Number.isFinite(now)) return null;
  const areas = [...wording.matchAll(CONTEXT_AREA)];
  if (areas.length !== 1 || !recognisedArea(areas[0]![1]!.trim())) return null;
  let rest = wording.replace(CONTEXT_AREA, " ");
  const dates = [...rest.matchAll(CONTEXT_DATE)];
  rest = rest.replace(CONTEXT_DATE, " ");
  const clocks = [...rest.matchAll(CLOCK)];
  const nights = [...rest.matchAll(CONTEXT_NIGHT)];
  if (dates.length > 1 || clocks.length > 1 || nights.length > 1
    || (!clocks.length && !nights.length)
    || (dates.length && nights.some((night) => /^tonight$/i.test(night[0])))
    || (clocks.length && nights.some((night) => !/^tonight$/i.test(night[0])))) return null;
  const minutes = clocks.length ? requestedMinutes(clocks[0]!) : null;
  if (clocks.length && minutes === null) return null;
  const date = dates[0]?.[1];
  if (date && !parseLondonInput(wallTimeInput(date, minutes ?? 0))) return null;
  rest = rest.replace(CLOCK, " ").replace(CONTEXT_NIGHT, " ");
  const dietary = [...rest.matchAll(DIETARY)].map((match) => match[0].toLowerCase().replace(" ", "-"));
  rest = rest.replace(DIETARY, " ");
  const foodWords = [...rest.matchAll(new RegExp(FOOD_RE.source, "gi"))].map((match) => match[0].toLowerCase());
  const categories = [...new Set(foodWords.filter((word) => !/^(?:food|eat|eating|meals?|kitchens?)$/.test(word))
    .map((word) => CATEGORIES.find(([pattern]) => pattern.test(word))?.[1] ?? word))];
  const category = categories.length === 1 ? CATEGORIES.find(([pattern]) => pattern.test(categories[0]!))?.[1] : null;
  if (categories.length > 1 || (categories.length === 1 && !category)) return null;
  rest = rest.replace(new RegExp(FOOD_RE.source, "gi"), " ")
    .replace(/\b(?:where|what|which|can|could|would|do|does|i|we|you|me|us|my|our|want|like|need|find|get|have|recommend|suggest|show|tell|help|is|are|there|any|some|something|somewhere|anywhere|places?|options?|open|available|a|an|the|to|for|with|that|please|serving)\b/gi, " ")
    .trim();
  if (rest) return null;
  let day = date ?? null;
  if (!day && nights.length && minutes !== null) {
    const current = new Date(now);
    day = londonDayKey(current);
    if (minutes < 12 * 60 && londonHour(current) >= NIGHT_SERVICE_END_HOUR) day = nextCalendarDay(day);
  }
  return {
    area: areas[0]![1]!.trim(),
    at: day !== null && minutes !== null ? londonInstant(day, minutes) : null,
    dietary,
    category: category ?? null,
  };
}

function clarificationFields(query: string): string {
  const polite = stripTrailingPunctuation(foodWording(query)).replace(/(?:\b(?:please|thanks)[\s,.!?;:]*)+$/i, "");
  const fragment = stripTrailingPunctuation(polite).replace(/^(?:actually|please|make\s+(?:that|it))\b[\s,:]*/i, "");
  if (recognisedArea(fragment)) return `near ${fragment}`;
  return fragment;
}

function isFoodClarification(query: string): boolean {
  const fragment = clarificationFields(query);
  return fragment.replace(CONTEXT_AREA, " ").replace(CONTEXT_DATE, " ")
    .replace(CLOCK, " ").replace(CONTEXT_NIGHT, " ").trim().length === 0 && fragment.length > 0;
}

function correctFoodQuery(previous: string, rawFragment: string): string {
  const fragment = clarificationFields(rawFragment);
  let query = previous;
  if ([...fragment.matchAll(CONTEXT_AREA)].length) query = query.replace(CONTEXT_AREA, " ");
  if ([...fragment.matchAll(CLOCK)].length) query = query.replace(CLOCK, " ").replace(/\bafter\s+midnight\b/gi, " ");
  if ([...fragment.matchAll(CONTEXT_DATE)].length || [...fragment.matchAll(CONTEXT_NIGHT)].length) {
    query = query.replace(CONTEXT_DATE, " ").replace(CONTEXT_NIGHT, " ");
  }
  return `${stripTrailingPunctuation(query)} ${fragment}`.replace(/\s+/g, " ").trim();
}

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
      if (!parseLateFoodQuestion(previous, Date.now())) return query;
      let corrected = previous;
      for (const fragment of fragments.reverse()) {
        corrected = correctFoodQuery(corrected, fragment);
        if (!parseLateFoodQuestion(corrected, Date.now())) return query;
      }
      return corrected;
    }
    if (!isFoodClarification(previous)) return query;
    fragments.push(previous);
  }
  return query;
}
