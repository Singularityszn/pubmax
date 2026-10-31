import { PLAN_PRICE_AMOUNT, planPriceLimits } from "@/lib/planPriceLimits";
import { formatGbp } from "@/lib/formatGbp";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import { londonHour } from "@/lib/londonHour";
import { NIGHT_SERVICE_END_HOUR, NIGHT_SERVICE_START_HOUR } from "@/lib/nightServiceHours";
import { NIGHT_AREAS, type NightAreaSlug } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightAreaSlugs";
import { planRequestedDrinkCategory } from "@/lib/planDrinkRequest";
import { tubeIsARouteRule } from "@/lib/planGetHome";
import { drinkKeywordSpans } from "@/lib/drinkCategoryFromText";
import { cleanText } from "@/lib/textClean";
import {
  DEFAULT_PLAN_STOP_COUNT,
  inferPlanStopCount,
  normalizePlanStopCount,
  type PlanStopCount,
} from "@/lib/planStopCount";

const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];
export { type NightAreaSlug };
const PARTY_TYPES = ["solo", "friends", "work"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];
const BUDGETS = ["value", "standard", "treat"] as const;
export type Budget = (typeof BUDGETS)[number];

export type NightContext = {
  nightArea: NightAreaSlug | null;
  daypart: Daypart;
  partyType: PartyType;
  groupSize: number | null;
  /** Requested pub stops. Missing legacy context means the default three. */
  stopCount?: PlanStopCount;
  budget: Budget;
  /** Explicit per-person budget for the three-stop route. Never inferred from profile history. */
  budgetLimitPence: number | null;
  zeroProof: boolean;
  /** Requested priced drink lane; null means no specific category was requested. */
  drinkCategory?: DrinkCategory | null;
  /**
   * Soft-prefer pubs that join the first-party J D Wetherspoon directory.
   * Never a hard filter: areas with few Spoons must still return three stops.
   */
  wetherspoonsPreferred: boolean;
  atmosphere: string[];
  foodNeeds: string[];
  accessibility: string[];
  transportConstraints: string[];
};

const DIET_ALLERGENS = "(gluten|nuts?|peanuts?|dairy|milk|lactose|eggs?|soy|soya|sesame|shellfish|wheat)";
const DIET_WORD = new RegExp(
  `\\b(?:(vegan|vegetarian|pescatarian|halal|kosher)s?|(coeliac|celiac)|${DIET_ALLERGENS}[ -]free`
    + `|(?:without|no|avoid|free\\s+(?:of|from))\\s+${DIET_ALLERGENS}`
    + `|${DIET_ALLERGENS}\\s+(?:allerg(?:y|ies|ic)|intoleran(?:t|ce))`
    + `|(allerg(?:y|ies|ic|en|ens)|intoleran(?:t|ce)))\\b`,
  "gi",
);

function allergenFree(word: string): string {
  const singular = word === "nuts" || word === "peanuts" || word === "eggs" ? word.slice(0, -1) : word;
  return `${singular === "soya" ? "soy" : singular}-free`;
}

/**
 * The dietary words a reader named, as foodNeeds tokens in the order named:
 * "vegan", "halal", "gluten-free", "nut-free", and "allergy" for an allergy or
 * intolerance with no named food. The planner cannot check a menu against any
 * of them, so they only shape scoring and a warning, never a refusal.
 */
export function planDietaryNeeds(...texts: readonly string[]): string[] {
  const needs: string[] = [];
  for (const text of texts) {
    for (const match of text.toLowerCase().matchAll(DIET_WORD)) {
      const [, diet, coeliac, freeOf, withoutOf, allergicTo, allergy] = match;
      const allergen = freeOf ?? withoutOf ?? allergicTo;
      const need = diet
        ?? (coeliac ? "gluten-free" : undefined)
        ?? (allergen ? allergenFree(allergen) : undefined)
        ?? (allergy ? "allergy" : undefined);
      if (need && !needs.includes(need)) needs.push(need);
    }
  }
  return needs;
}

/**
 * Transport words, as preferences that never refuse a route: walking is the
 * optimiser's own leg rule, and a tube, underground or station word
 * soft-prefers pubs near a station.
 */
function transportPreferences(lower: string): string[] {
  const tube = tubeIsARouteRule(lower)
    || /\bunderground\b|\bnear (?:an? |the )?(?:tube |train |rail )?stations?\b/.test(lower);
  return [...(tube ? ["tube"] : []), ...(/walk/.test(lower) ? ["walking"] : [])];
}

export type ContextReason = { field: keyof NightContext; evidence: string; explanation: string };
export type InferredNightContext = { context: NightContext; confidence: number; reasons: ContextReason[] };

const AREA_LABELS = NIGHT_AREAS
  .flatMap((area) => [area.name, ...area.aliases].map((label) => ({ slug: area.slug, label })))
  .sort((a, b) => b.label.length - a.label.length);

function defaultDaypart(now: Date): Daypart {
  const hour = londonHour(now);
  // The small hours (past midnight, before the daytime cutoff) are still last
  // night's late_night, not the next day's daytime — check them before the
  // hour < 16 daytime band so they cannot be swallowed by it.
  if (hour < NIGHT_SERVICE_END_HOUR) return "late_night";
  if (hour < NIGHT_SERVICE_START_HOUR) return "daytime";
  if (hour < 19) return "after_work";
  if (hour < 23) return "evening";
  return "get_home";
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Names the chain in free text (Wetherspoon / Wetherspoons / Spoons). */
const WETHERSPOONS_QUERY_PATTERN = /\bwetherspoons?\b|\bspoons\b/i;

function requestedDrinkCategory(query: string, zeroProof: boolean, reasons: ContextReason[]): DrinkCategory | null {
  const category = planRequestedDrinkCategory(query);
  // Zero-proof intent hides alcoholic lanes, but an explicit Soft drinks request stays a specific choice.
  if (zeroProof && category !== "soft-drink") return null;
  if (category) {
    reasons.push({ field: "drinkCategory", evidence: category, explanation: "Matched the requested drink category." });
  }
  return category;
}

function hasZeroAlcoholStrength(query: string): boolean {
  const text = query.replace(new RegExp(PLAN_PRICE_AMOUNT, "gi"), " ");
  const strengths = [...text.matchAll(/(?:^|[^a-z0-9£.,])0\.0(?![a-z0-9.,])/g)];
  if (!strengths.length) return false;
  const drinks = drinkKeywordSpans(text);
  return strengths.some((match) => {
    const end = match.index + match[0].length;
    const start = end - 3;
    return /^\s*(?:%|abv\b)/.test(text.slice(end)) || drinks.some((drink) =>
      (drink.start <= start && drink.end >= end && /[a-z]/.test(text.slice(drink.start, drink.end)))
      || (drink.start >= end && /^\s*$/.test(text.slice(end, drink.start)))
      || (drink.end <= start && /^\s*$/.test(text.slice(drink.end, start))));
  });
}

export function inferNightContext(rawQuery: unknown, now = new Date()): InferredNightContext {
  const query = cleanText(rawQuery, 500);
  const lower = query.toLocaleLowerCase();
  const reasons: ContextReason[] = [];
  const areaMatch = AREA_LABELS.find(({ label }) => lower.includes(label.toLocaleLowerCase()));
  if (areaMatch) reasons.push({ field: "nightArea", evidence: areaMatch.label, explanation: "Matched the requested area." });

  let daypart = defaultDaypart(now);
  // Explicit clock words win over occasion language. Coffee / catch-up / Spoons
  // are daytime occasions only when no stronger time-of-day word is present.
  const daypartMatchers: Array<[Daypart, RegExp, string]> = [
    ["after_work", /after[ -]?work|leaving do/, "after work"],
    ["get_home", /get home|last train|heading home/, "get home"],
    ["late_night", /late[ -]?night|after midnight/, "late night"],
    ["evening", /evening|tonight/, "evening"],
    ["daytime", /daytime|lunch|afternoon|brunch|\bcoffee\b|catch[ -]?up/, "daytime"],
  ];
  const explicitDaypart = daypartMatchers.find(([, pattern]) => pattern.test(lower));
  if (explicitDaypart) {
    daypart = explicitDaypart[0];
    reasons.push({ field: "daypart", evidence: explicitDaypart[2], explanation: "Matched the requested time of day." });
  }

  const spoonsMentioned = WETHERSPOONS_QUERY_PATTERN.test(lower);
  // Spoons is a value chain with no generate-time hard filter: when the query
  // names it and no clock word won above, stick daytime + value so the chill
  // Spoons occasion still shapes ranking (see chip honesty tests).
  if (!explicitDaypart && spoonsMentioned) {
    daypart = "daytime";
    reasons.push({ field: "daypart", evidence: "Wetherspoons", explanation: "Spoons outing defaults to daytime when no clock word is stated." });
  }

  const numeric =
    lower.match(/\b(\d{1,2})\s*(?:of us|people|mates|friends)\b/) ??
    lower.match(/\b(?:for|party of|group of)\s+(\d{1,2})\b/);
  const word = Object.entries(NUMBER_WORDS).find(([label]) =>
    new RegExp(`\\b(?:${label}\\s+(?:of us|people|mates|friends)|(?:for|party of|group of)\\s+${label})\\b`).test(lower),
  );
  const groupSize = numeric ? Number(numeric[1]) : word?.[1] ?? null;
  if (groupSize) reasons.push({ field: "groupSize", evidence: numeric?.[1] ?? (word?.[0].replace(/^./, (c) => c.toUpperCase()) ?? ""), explanation: "Matched the stated group size." });

  const stopCount = inferPlanStopCount(lower, NUMBER_WORDS);
  if (stopCount !== DEFAULT_PLAN_STOP_COUNT) {
    reasons.push({ field: "stopCount", evidence: `${stopCount} stops`, explanation: "Matched the requested number of stops." });
  }

  const partyType: PartyType = /colleague|team|work social|leaving do/.test(lower) ? "work" : /solo|just me|on my own/.test(lower) ? "solo" : "friends";
  const budget: Budget = /cheap|budget|value|not pricey|wetherspoons?|\bspoons\b/.test(lower)
    ? "value"
    : /special|splash out|treat/.test(lower)
      ? "treat"
      : "standard";
  const budgetLimitPence = planPriceLimits(query).routeBudgetPence;
  if (budgetLimitPence) reasons.push({ field: "budgetLimitPence", evidence: formatGbp(budgetLimitPence / 100), explanation: "Matched the explicit per-person route budget." });
  const atmosphere = ["quiet", "lively", "historic", "cosy", "sports", "music", "garden"].filter((value) => lower.includes(value));
  // Chill is the everyday synonym for quiet on describe-first chips; ranking
  // only scores the closed "quiet" token, so map rather than invent a new one.
  if (/\bchill\b/.test(lower) && !atmosphere.includes("quiet")) atmosphere.push("quiet");
  const foodNeeds = ["kebab", "pizza", "chips"].filter((value) => lower.includes(value));
  for (const need of planDietaryNeeds(lower)) if (!foodNeeds.includes(need)) foodNeeds.push(need);
  // Bare "food" marks the outing as food-aware for ranking and endings. It is
  // not a cuisine filter (lateFood drops this non-specific tag).
  if (/\bfood\b/.test(lower) && !foodNeeds.includes("food")) foodNeeds.push("food");
  const accessibility = /wheelchair|step[- ]free|accessible/.test(lower) ? ["step-free"] : [];
  // Each word the reader names, not the first one that matches: a tube used to
  // win a ternary and take the walk rule out of the record with it, so "walk
  // between stops, then home by tube" routed while the same sentence without
  // the tube failed closed. A whole word on the tube arm, because "YouTube" is
  // no transport at all, and only a tube named as the WAY HOME is dropped from
  // the route rules, which lib/planGetHome.ts decides.
  const transportConstraints = transportPreferences(lower);
  const zeroProof = /zero[ -]?proof|alcohol[ -]?free|\bno[ -]alcohol\b|soft[ -]?drinks?|not drinking|sober/.test(lower)
    || hasZeroAlcoholStrength(lower);
  const drinkCategory = requestedDrinkCategory(query, zeroProof, reasons);
  const wetherspoonsPreferred = spoonsMentioned;
  if (wetherspoonsPreferred) {
    reasons.push({
      field: "wetherspoonsPreferred",
      evidence: "Wetherspoons",
      explanation: "Soft-prefers pubs matched to the first-party J D Wetherspoon directory.",
    });
  }

  return {
    context: {
      nightArea: areaMatch?.slug ?? null,
      daypart,
      partyType,
      groupSize,
      stopCount,
      budget,
      budgetLimitPence,
      zeroProof,
      drinkCategory,
      wetherspoonsPreferred,
      atmosphere,
      foodNeeds,
      accessibility,
      transportConstraints,
    },
    confidence: areaMatch ? 0.86 : 0.62,
    reasons,
  };
}

// Owned by the slug leaf so a caller that only validates a slug skips this
// module's graph; re-exported so the planner's callers keep one door.
export { isNightAreaSlug };

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
    ...(row.stopCount === undefined
      ? {}
      : { stopCount: normalizePlanStopCount(row.stopCount) }),
    ...(isBudget(row.budget) ? { budget: row.budget } : {}),
    ...(row.budgetLimitPence === null
      ? { budgetLimitPence: null }
      : typeof row.budgetLimitPence === "number" && Number.isInteger(row.budgetLimitPence) && row.budgetLimitPence >= 500 && row.budgetLimitPence <= 50_000
        ? { budgetLimitPence: row.budgetLimitPence }
        : {}),
    ...(typeof row.zeroProof === "boolean" ? { zeroProof: row.zeroProof } : {}),
    ...(row.drinkCategory === null || isDrinkCategory(row.drinkCategory) ? { drinkCategory: row.drinkCategory } : {}),
    ...(typeof row.wetherspoonsPreferred === "boolean" ? { wetherspoonsPreferred: row.wetherspoonsPreferred } : {}),
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
    stopCount: normalizePlanStopCount(row.stopCount),
    budget: row.budget as Budget,
    budgetLimitPence: typeof row.budgetLimitPence === "number" && Number.isInteger(row.budgetLimitPence) && row.budgetLimitPence >= 500 && row.budgetLimitPence <= 50_000
      ? row.budgetLimitPence
      : null,
    zeroProof: row.zeroProof === true,
    drinkCategory: isDrinkCategory(row.drinkCategory) ? row.drinkCategory : null,
    wetherspoonsPreferred: row.wetherspoonsPreferred === true,
    atmosphere: cleanContextList(row.atmosphere) ?? [],
    foodNeeds: cleanContextList(row.foodNeeds) ?? [],
    accessibility: cleanContextList(row.accessibility) ?? [],
    transportConstraints: cleanContextList(row.transportConstraints) ?? [],
  };
}
