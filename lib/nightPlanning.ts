import { NIGHT_AREAS, NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { cleanText } from "@/lib/textClean";

export const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];
export { type NightAreaSlug };
export const PARTY_TYPES = ["solo", "friends", "work"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];
export const BUDGETS = ["value", "standard", "treat"] as const;
export type Budget = (typeof BUDGETS)[number];

export type NightContext = {
  nightArea: NightAreaSlug | null;
  daypart: Daypart;
  partyType: PartyType;
  groupSize: number | null;
  budget: Budget;
  atmosphere: string[];
  foodNeeds: string[];
  accessibility: string[];
  transportConstraints: string[];
};

export type ContextReason = { field: keyof NightContext; evidence: string; explanation: string };
export type InferredNightContext = { context: NightContext; confidence: number; reasons: ContextReason[] };

const AREA_LABELS = NIGHT_AREAS
  .flatMap((area) => [area.name, ...area.aliases].map((label) => ({ slug: area.slug, label })))
  .sort((a, b) => b.label.length - a.label.length);

function londonHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(now));
}

function defaultDaypart(now: Date): Daypart {
  const hour = londonHour(now);
  if (hour < 16) return "daytime";
  if (hour < 19) return "after_work";
  if (hour < 23) return "evening";
  return hour < 4 ? "late_night" : "get_home";
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export function inferNightContext(rawQuery: unknown, now = new Date()): InferredNightContext {
  const query = cleanText(rawQuery, 500);
  const lower = query.toLocaleLowerCase();
  const reasons: ContextReason[] = [];
  const areaMatch = AREA_LABELS.find(({ label }) => lower.includes(label.toLocaleLowerCase()));
  if (areaMatch) reasons.push({ field: "nightArea", evidence: areaMatch.label, explanation: "Matched a Night Area." });

  let daypart = defaultDaypart(now);
  const daypartMatchers: Array<[Daypart, RegExp, string]> = [
    ["after_work", /after[ -]?work|leaving do/, "after work"],
    ["get_home", /get home|last train|heading home/, "get home"],
    ["late_night", /late[ -]?night|after midnight/, "late night"],
    ["daytime", /daytime|lunch|afternoon/, "daytime"],
    ["evening", /evening|tonight/, "evening"],
  ];
  const explicitDaypart = daypartMatchers.find(([, pattern]) => pattern.test(lower));
  if (explicitDaypart) {
    daypart = explicitDaypart[0];
    reasons.push({ field: "daypart", evidence: explicitDaypart[2], explanation: "Matched the requested time of day." });
  }

  const numeric =
    lower.match(/\b(\d{1,2})\s*(?:of us|people|mates|friends)\b/) ??
    lower.match(/\b(?:for|party of|group of)\s+(\d{1,2})\b/);
  const word = Object.entries(NUMBER_WORDS).find(([label]) =>
    new RegExp(`\\b(?:${label}\\s+(?:of us|people|mates|friends)|(?:for|party of|group of)\\s+${label})\\b`).test(lower),
  );
  const groupSize = numeric ? Number(numeric[1]) : word?.[1] ?? null;
  if (groupSize) reasons.push({ field: "groupSize", evidence: numeric?.[1] ?? (word?.[0].replace(/^./, (c) => c.toUpperCase()) ?? ""), explanation: "Matched the stated group size." });

  const partyType: PartyType = /colleague|team|work social|leaving do/.test(lower) ? "work" : /solo|just me|on my own/.test(lower) ? "solo" : "friends";
  const budget: Budget = /cheap|budget|value|not pricey/.test(lower) ? "value" : /special|splash out|treat/.test(lower) ? "treat" : "standard";
  const atmosphere = ["quiet", "lively", "historic", "cosy", "sports", "music"].filter((value) => lower.includes(value));
  const foodNeeds = ["kebab", "pizza", "chips", "vegan", "vegetarian", "halal"].filter((value) => lower.includes(value));
  const accessibility = /wheelchair|step[- ]free|accessible/.test(lower) ? ["step-free"] : [];
  const transportConstraints = /tube/.test(lower) ? ["tube"] : /walk/.test(lower) ? ["walking"] : [];

  return {
    context: { nightArea: areaMatch?.slug ?? null, daypart, partyType, groupSize, budget, atmosphere, foodNeeds, accessibility, transportConstraints },
    confidence: areaMatch ? 0.86 : 0.62,
    reasons,
  };
}

export function isNightAreaSlug(value: unknown): value is NightAreaSlug {
  return typeof value === "string" && (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export function isDaypart(value: unknown): value is Daypart {
  return typeof value === "string" && (DAYPARTS as readonly string[]).includes(value);
}

export function isPartyType(value: unknown): value is PartyType {
  return typeof value === "string" && (PARTY_TYPES as readonly string[]).includes(value);
}

export function isBudget(value: unknown): value is Budget {
  return typeof value === "string" && (BUDGETS as readonly string[]).includes(value);
}

function cleanContextList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 8)
    .map((item) => cleanText(item, 40))
    .filter(Boolean);
}

export function cleanNightContextPatch(value: unknown): Partial<NightContext> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const atmosphere = cleanContextList(row.atmosphere);
  const foodNeeds = cleanContextList(row.foodNeeds);
  const accessibility = cleanContextList(row.accessibility);
  const transportConstraints = cleanContextList(row.transportConstraints);

  return {
    ...(row.nightArea === null || isNightAreaSlug(row.nightArea) ? { nightArea: row.nightArea } : {}),
    ...(isDaypart(row.daypart) ? { daypart: row.daypart } : {}),
    ...(isPartyType(row.partyType) ? { partyType: row.partyType } : {}),
    ...(row.groupSize === null
      ? { groupSize: null }
      : typeof row.groupSize === "number" && row.groupSize >= 1 && row.groupSize <= 30
        ? { groupSize: Math.floor(row.groupSize) }
        : {}),
    ...(isBudget(row.budget) ? { budget: row.budget } : {}),
    ...(atmosphere ? { atmosphere } : {}),
    ...(foodNeeds ? { foodNeeds } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...(transportConstraints ? { transportConstraints } : {}),
  };
}

export function cleanNightContext(value: unknown): NightContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isNightAreaSlug(row.nightArea) || !isDaypart(row.daypart)) return null;
  if (!isPartyType(row.partyType)) return null;
  if (!isBudget(row.budget)) return null;
  return {
    nightArea: row.nightArea,
    daypart: row.daypart as Daypart,
    partyType: row.partyType as PartyType,
    groupSize: typeof row.groupSize === "number" && row.groupSize >= 1 && row.groupSize <= 30 ? Math.floor(row.groupSize) : null,
    budget: row.budget as Budget,
    atmosphere: cleanContextList(row.atmosphere) ?? [],
    foodNeeds: cleanContextList(row.foodNeeds) ?? [],
    accessibility: cleanContextList(row.accessibility) ?? [],
    transportConstraints: cleanContextList(row.transportConstraints) ?? [],
  };
}
