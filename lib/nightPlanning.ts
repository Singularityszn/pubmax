import { cleanText } from "@/lib/textClean";

export const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];
export const NIGHT_AREA_SLUGS = ["clapham", "victoria", "piccadilly-soho", "canary-wharf", "barnes", "chiswick"] as const;
export type NightAreaSlug = (typeof NIGHT_AREA_SLUGS)[number];
export type PartyType = "solo" | "friends" | "work";
export type Budget = "value" | "standard" | "treat";

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

const AREAS: Array<{ slug: NightAreaSlug; labels: string[] }> = [
  { slug: "clapham", labels: ["clapham"] },
  { slug: "victoria", labels: ["victoria"] },
  { slug: "piccadilly-soho", labels: ["piccadilly", "soho"] },
  { slug: "canary-wharf", labels: ["canary wharf"] },
  { slug: "barnes", labels: ["barnes"] },
  { slug: "chiswick", labels: ["chiswick"] },
];

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
  const areaMatch = AREAS.find((area) => area.labels.some((label) => lower.includes(label)));
  if (areaMatch) {
    const evidence = areaMatch.labels.find((label) => lower.includes(label)) ?? areaMatch.labels[0];
    reasons.push({ field: "nightArea", evidence: evidence.replace(/\b\w/g, (letter) => letter.toUpperCase()), explanation: "Matched a pilot Night Area." });
  }

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

  const numeric = lower.match(/\b(\d{1,2})\s*(?:of us|people|mates|friends)\b/);
  const word = Object.entries(NUMBER_WORDS).find(([label]) => new RegExp(`\\b${label}\\s+(?:of us|people|mates|friends)\\b`).test(lower));
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

export function cleanNightContext(value: unknown): NightContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isNightAreaSlug(row.nightArea) || !DAYPARTS.includes(row.daypart as Daypart)) return null;
  if (!(["solo", "friends", "work"] as unknown[]).includes(row.partyType)) return null;
  if (!(["value", "standard", "treat"] as unknown[]).includes(row.budget)) return null;
  const list = (input: unknown) => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => cleanText(item, 40)).filter(Boolean) : [];
  return {
    nightArea: row.nightArea,
    daypart: row.daypart as Daypart,
    partyType: row.partyType as PartyType,
    groupSize: typeof row.groupSize === "number" && row.groupSize >= 1 && row.groupSize <= 30 ? Math.floor(row.groupSize) : null,
    budget: row.budget as Budget,
    atmosphere: list(row.atmosphere), foodNeeds: list(row.foodNeeds), accessibility: list(row.accessibility), transportConstraints: list(row.transportConstraints),
  };
}
