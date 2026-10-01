// Nightly Tavily pass over the curated London index.
//
// The shared drink reader in lib/harvest/ukPriceCrawl.ts decides whether a
// figure was stated. This module adds the night's budget, the resume cursor,
// and the Listed queue. A web price is evidence for a curator. It is never a
// Confirmed price and never a community price.

import {
  isOperatorHost,
  parseStatedOpeningHours,
  pickOperatorUrl,
  type OperatorSearchResult,
} from "@/lib/harvest/pubFacts";
import { isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";
import {
  decideKeylessUkPriceCandidate,
  findUkPriceCandidates,
  isLikelyMenuUrl,
  pageText,
  drinkLabelFromPriceContext,
} from "@/lib/harvest/ukPriceCrawl";

export const SEARCH_CREDIT_COST = 1;
export const EXTRACT_CREDIT_COST = 1;

const DEFAULT_RESERVE_CREDITS = 50;
const DEFAULT_STALE_DAYS = 30;
const BEER_MIN_GBP = 2;
const BEER_MAX_GBP = 12;
const FOOD_MIN_GBP = 2;
const FOOD_MAX_GBP = 40;
const DAY_MS = 86_400_000;

const SEED_PATCHES = ["soho", "clapham", "shoreditch", "islington", "camden"] as const;
const THIN_BOROUGHS = new Set(["barking and dagenham", "kingston upon thames", "hounslow"]);

const FOOD_LINE =
  /\b(burger|steak|pizza|fish and chips|chips|roast|breakfast|brunch|lunch|dinner|sandwich|curry|dessert|pie|salad|wings|nachos|sausage|halloumi|scampi|prawn)\b/i;
const SERVES_FOOD = /\b(we serve food|food served|food menu|kitchen open|our kitchen|bar snacks)\b/i;
const NO_FOOD = /\b(do not serve food|no food served|food is not served|kitchen closed|we do not serve food)\b/i;
const VAGUE_NAME = /^(about|around|roughly|approximately|only|from|just|under|over)$/i;

const AMENITY_LINES: ReadonlyArray<{ kind: AmenityKind; pattern: RegExp }> = [
  { kind: "beer-garden", pattern: /\b(beer garden|pub garden|beer-garden)\b/i },
  { kind: "live-sport", pattern: /\b(live sport|sky sports|tnt sports|bt sport)\b/i },
  { kind: "quiz", pattern: /\b(pub quiz|quiz night|quiz)\b/i },
  { kind: "music", pattern: /\b(live music|music night|\bdj\b)\b/i },
];

const CLOSURE_LINE = /\b(permanently closed|we have closed|now closed|closed for good|reopened as|formerly known as)\b/i;
const PHONE_LINE = /\b(0\d{2,4}\s\d{3,4}\s\d{3,4}|\+44\s?\d{2,4}\s\d{3,4}\s\d{3,4})\b/;
const FOOD_PATH = /(food|kitchen|lunch|dinner|brunch|\beat\b)/i;
const FOOD_PATH_EXCLUDE = /(privacy|cookie|terms|careers|login|account|basket|checkout)/i;

type DrinkSize = "pint" | "keg" | "bottle" | "can" | "unstated";
type AmenityKind = "beer-garden" | "live-sport" | "quiz" | "music";

type TavilyUsage = {
  key: { usage: number; limit: number | null };
  account: { current_plan: string; plan_usage: number | null; plan_limit: number | null };
};

type Allowance = {
  credits: number;
  remaining: number;
  daysLeft: number;
  plan: string;
  reason: string;
};

type NightlyVenue = {
  id: string;
  name: string;
  postcode: string;
  borough: string;
  areaText: string;
  priced: boolean;
};

type NightlyCursor = {
  version: 1;
  lastSeen: Record<string, string>;
};

type ListedDrinkLine = {
  drink: string;
  size: DrinkSize;
  sizeDetail: string | null;
  priceGbp: number;
  standing: "listed";
  sourceUrl: string;
  seenOn: string;
};

type FoodDish = {
  name: string;
  priceGbp: number;
  sourceUrl: string;
  seenOn: string;
};

type FoodFacts = {
  served: boolean | null;
  priceMinGbp: number | null;
  priceMaxGbp: number | null;
  dishes: FoodDish[];
  sourceUrl: string | null;
  seenOn: string | null;
};

type AmenityFact = {
  kind: AmenityKind;
  quote: string;
  sourceUrl: string;
  seenOn: string;
};

type SourcedFact = {
  sourceUrl: string;
  seenOn: string;
};

type PageFacts = {
  drinks: ListedDrinkLine[];
  food: FoodFacts;
  amenities: AmenityFact[];
  hours: ({ statedDays: string[] } & SourcedFact) | null;
  phone: ({ value: string } & SourcedFact) | null;
  closure: ({ quote: string } & SourcedFact) | null;
};

type VenueEvidence = {
  venueId: string;
  name: string;
  postcode: string;
  borough: string;
  seenOn: string;
  website: ({ url: string } & SourcedFact) | null;
  drinks: ListedDrinkLine[];
  food: FoodFacts;
  amenities: AmenityFact[];
  hours: PageFacts["hours"];
  phone: PageFacts["phone"];
  closure: PageFacts["closure"];
};

type QueueDocument = {
  version: 1;
  standingRule: "listed";
  venues: VenueEvidence[];
};

type SearchHit = OperatorSearchResult & { content?: string };

type NightlyRequest =
  | { kind: "search"; venueId: string; query: string }
  | { kind: "extract"; venueId: string; urls: string[] };

type NightlyArgs = {
  dryRun: boolean;
  manualCap: number | null;
  reserveCredits: number;
  staleAfterDays: number;
  usageFile: string | null;
};

type SpendLedger = {
  spent: number;
  exhausted: boolean;
  canSpend(cost: number): boolean;
  record(cost: number): void;
};

function nonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function daysLeftInCycle(now: Date): number {
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return last - now.getUTCDate() + 1;
}

export function readTavilyUsage(payload: unknown): TavilyUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;
  const key = body.key;
  if (typeof key !== "object" || key === null) return null;
  const keyRow = key as Record<string, unknown>;
  const keyUsage = nonNegative(keyRow.usage);
  if (keyUsage === null) return null;
  const keyLimit = nonNegative(keyRow.limit);
  const account = body.account;
  const accountRow = typeof account === "object" && account !== null ? (account as Record<string, unknown>) : null;
  const planLimit = accountRow ? nonNegative(accountRow.plan_limit) : null;
  const planUsage = accountRow ? nonNegative(accountRow.plan_usage) : null;
  if (keyLimit === null && planLimit === null) return null;
  if (planLimit !== null && planUsage === null) return null;
  const plan = accountRow && typeof accountRow.current_plan === "string" ? accountRow.current_plan : "unknown";
  return {
    key: { usage: keyUsage, limit: keyLimit },
    account: { current_plan: plan, plan_usage: planUsage, plan_limit: planLimit },
  };
}

export function tonightAllowance(input: {
  usage: unknown;
  now: Date;
  reserveCredits?: number;
  manualCap?: number | null;
}): Allowance {
  const daysLeft = daysLeftInCycle(input.now);
  const parsed = readTavilyUsage(input.usage);
  if (!parsed) {
    return { credits: 0, remaining: 0, daysLeft, plan: "unknown", reason: "no-plan-limit" };
  }
  const pools: number[] = [];
  if (parsed.account.plan_limit !== null && parsed.account.plan_usage !== null) {
    pools.push(Math.max(0, parsed.account.plan_limit - parsed.account.plan_usage));
  }
  if (parsed.key.limit !== null) pools.push(Math.max(0, parsed.key.limit - parsed.key.usage));
  const remaining = pools.length > 0 ? Math.min(...pools) : 0;
  const reserve = input.reserveCredits ?? DEFAULT_RESERVE_CREDITS;
  const spendable = Math.max(0, remaining - reserve);
  let credits = daysLeft > 0 ? Math.floor(spendable / daysLeft) : 0;
  let reason = "plan";
  if (input.manualCap !== undefined && input.manualCap !== null) {
    credits = Math.min(credits, input.manualCap);
    if (input.manualCap <= credits) reason = "manual-cap";
  }
  if (spendable === 0) reason = "reserve";
  return { credits, remaining, daysLeft, plan: parsed.account.current_plan, reason };
}

export function openSpendLedger(allowanceCredits: number): SpendLedger {
  let spent = 0;
  let exhausted = allowanceCredits <= 0;
  return {
    get spent() {
      return spent;
    },
    get exhausted() {
      return exhausted;
    },
    canSpend(cost: number) {
      return !exhausted && Number.isFinite(cost) && cost >= 0 && spent + cost <= allowanceCredits;
    },
    record(cost: number) {
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        throw new Error("A Tavily credit cost must be a non-negative number.");
      }
      spent += cost;
      if (spent >= allowanceCredits) exhausted = true;
    },
  };
}

export function reportedCredits(payload: unknown, fallback: number): number {
  if (typeof payload !== "object" || payload === null) return fallback;
  const body = payload as Record<string, unknown>;
  const usage = typeof body.usage === "object" && body.usage !== null ? (body.usage as Record<string, unknown>) : null;
  const raw = usage && "credits" in usage ? usage.credits : body.credits;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return fallback;
}

function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string): number | null {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

function isDue(id: string, cursor: NightlyCursor, today: string, staleAfterDays: number): boolean {
  const seen = cursor.lastSeen[id];
  if (!seen) return true;
  if (seen === today) return false;
  const age = daysBetween(seen, today);
  return age !== null && age >= 0 && age >= staleAfterDays;
}

function wordHit(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(haystack);
}

function isSeed(venue: NightlyVenue): boolean {
  const borough = venue.borough.toLowerCase();
  const area = `${venue.areaText} ${venue.name}`.toLowerCase();
  return SEED_PATCHES.some((seed) => borough === seed || wordHit(borough, seed) || wordHit(area, seed));
}

function isThin(venue: NightlyVenue): boolean {
  return THIN_BOROUGHS.has(venue.borough.trim().toLowerCase());
}

function priorityTier(venue: NightlyVenue): number {
  const band = venue.priced ? 3 : 0;
  const place = isSeed(venue) ? 0 : isThin(venue) ? 1 : 2;
  return band + place;
}

export function selectNightlyVenues(
  venues: readonly NightlyVenue[],
  cursor: NightlyCursor,
  options: { today: string; staleAfterDays: number; limit: number },
): NightlyVenue[] {
  return venues
    .filter((venue) => isDue(venue.id, cursor, options.today, options.staleAfterDays))
    .sort((a, b) => {
      const tier = priorityTier(a) - priorityTier(b);
      if (tier !== 0) return tier;
      const seen = (cursor.lastSeen[a.id] ?? "").localeCompare(cursor.lastSeen[b.id] ?? "");
      if (seen !== 0) return seen;
      return a.id.localeCompare(b.id);
    })
    .slice(0, Math.max(0, options.limit));
}

export function advanceCursor(cursor: NightlyCursor, venueIds: readonly string[], today: string): NightlyCursor {
  const lastSeen = { ...cursor.lastSeen };
  for (const id of venueIds) lastSeen[id] = today;
  return { version: 1, lastSeen };
}

function formatPostcode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (!match) return compact;
  return `${match[1]} ${match[2]}`;
}

function compactPostcode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function venueKey(venue: { id?: string; venueId?: string; postcode: string }): string {
  const id = venue.id ?? venue.venueId ?? "";
  return `${id}|${formatPostcode(venue.postcode)}`;
}

export function toNightlyVenue(row: unknown): NightlyVenue | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  const hints = typeof record.filterHints === "object" && record.filterHints !== null
    ? (record.filterHints as Record<string, unknown>)
    : null;
  const searchText = hints && typeof hints.searchText === "string" ? hints.searchText : "";
  const found = searchText.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i);
  const price = record.cheapestPrice;
  return {
    id: record.id,
    name: record.name,
    postcode: found ? formatPostcode(`${found[1]}${found[2]}`) : "",
    borough: typeof record.borough === "string" ? record.borough : "",
    areaText: searchText,
    priced: typeof price === "number" && Number.isFinite(price) && price > 0,
  };
}

export function chooseOperatorUrl(results: readonly SearchHit[], venue: { name: string; postcode: string }): string | null {
  const eligible = results.filter((result) => isOperatorHost(result.url) && isHarvestableOperatorUrl(result.url));
  const wanted = compactPostcode(venue.postcode);
  const narrowed = wanted
    ? eligible.filter((result) => compactPostcode(`${result.title ?? ""} ${result.content ?? ""}`).includes(wanted))
    : [];
  return pickOperatorUrl(narrowed.length > 0 ? narrowed : eligible, venue.name);
}

function sameSite(candidate: string, siteOrigin: string): boolean {
  try {
    const url = new URL(candidate, siteOrigin);
    const origin = new URL(siteOrigin);
    const host = url.hostname.replace(/^www\./, "");
    const known = origin.hostname.replace(/^www\./, "");
    return host === known || host.endsWith(`.${known}`);
  } catch {
    return false;
  }
}

function isLikelyFoodMenuUrl(candidate: string, siteOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate, siteOrigin);
  } catch {
    return false;
  }
  if (!sameSite(url.href, siteOrigin)) return false;
  const pathAndSearch = `${url.pathname}${url.search}`;
  if (FOOD_PATH_EXCLUDE.test(pathAndSearch) || !FOOD_PATH.test(pathAndSearch)) return false;
  if (!/(\.pdf|\.html?|\/)$/i.test(url.pathname) && /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return false;
  return url.protocol === "http:" || url.protocol === "https:";
}

export function acceptedExtractUrls(urls: readonly string[], siteOrigin: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (!isHarvestableOperatorUrl(raw) || !sameSite(raw, siteOrigin)) continue;
    let href: string;
    try {
      href = new URL(raw).href;
    } catch {
      continue;
    }
    if (!isLikelyMenuUrl(href, siteOrigin) && !isLikelyFoodMenuUrl(href, siteOrigin)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= 4) break;
  }
  return out;
}

function cleanName(label: string): string | null {
  const cleaned = label
    .replace(/\b\d{2,4}\s*ml\b/gi, " ")
    .replace(/\b(keg|pints?|bottles?|cans?)\b/gi, " ")
    .replace(/[/|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "")
    .trim();
  if (cleaned.length < 2 || VAGUE_NAME.test(cleaned)) return null;
  return cleaned;
}

function sizeOf(line: string): { size: DrinkSize; sizeDetail: string | null } {
  if (/\b568\s*ml\b/i.test(line) || /\bpints?\b/i.test(line)) return { size: "pint", sizeDetail: "pint" };
  const ml = /\b(\d{2,4})\s*ml\b/i.exec(line);
  const detail = ml ? `${ml[1]}ml` : null;
  if (/\bcans?\b/i.test(line)) return { size: "can", sizeDetail: detail ?? "can" };
  if (detail && detail !== "568ml") return { size: "bottle", sizeDetail: detail };
  if (/\bbottles?\b/i.test(line)) return { size: "bottle", sizeDetail: "bottle" };
  if (/\bkeg\b/i.test(line)) return { size: "keg", sizeDetail: null };
  return { size: "unstated", sizeDetail: null };
}

function inBand(priceGbp: number, min: number, max: number): boolean {
  return priceGbp >= min && priceGbp <= max;
}

function listedDrink(
  name: string,
  line: string,
  priceGbp: number,
  sourceUrl: string,
  seenOn: string,
  forced?: { size: DrinkSize; sizeDetail: string | null },
): ListedDrinkLine | null {
  const drink = cleanName(name);
  if (!drink || !inBand(priceGbp, BEER_MIN_GBP, BEER_MAX_GBP)) return null;
  const size = forced ?? sizeOf(line);
  return {
    drink,
    size: size.size,
    sizeDetail: size.sizeDetail,
    priceGbp,
    standing: "listed",
    sourceUrl,
    seenOn,
  };
}

function emptyFood(): FoodFacts {
  return { served: null, priceMinGbp: null, priceMaxGbp: null, dishes: [], sourceUrl: null, seenOn: null };
}

type PriceOutcome = ReturnType<typeof decideKeylessUkPriceCandidate>;

function recordAmenityMatches(amenities: AmenityFact[], line: string, fact: SourcedFact): void {
  for (const amenity of AMENITY_LINES) {
    if (!amenity.pattern.test(line)) continue;
    amenities.push({
      kind: amenity.kind,
      quote: line.slice(0, 180),
      sourceUrl: fact.sourceUrl,
      seenOn: fact.seenOn,
    });
  }
}

function isFoodEvidence(line: string, outcome: PriceOutcome): boolean {
  return (
    FOOD_LINE.test(line) &&
    (outcome.drop === "food-word-nearby" || outcome.drop === "no-category-word-nearby" || !outcome.kept)
  );
}

function recordFoodDish(
  dishes: FoodDish[],
  seenDishes: Set<string>,
  label: string,
  priceGbp: number,
  fact: SourcedFact,
): void {
  const name = cleanName(label);
  if (!name || !inBand(priceGbp, FOOD_MIN_GBP, FOOD_MAX_GBP)) return;
  const key = `${name.toLowerCase()}|${priceGbp}`;
  if (seenDishes.has(key)) return;
  seenDishes.add(key);
  dishes.push({ name, priceGbp, sourceUrl: fact.sourceUrl, seenOn: fact.seenOn });
}

function drinkFromDrop(
  line: string,
  label: string,
  priceGbp: number,
  drop: PriceOutcome["drop"],
  fact: SourcedFact,
): ListedDrinkLine | null {
  if (drop === "bottled-measure-not-a-pint") {
    const size = sizeOf(line);
    return listedDrink(label, line, priceGbp, fact.sourceUrl, fact.seenOn, {
      size: size.size === "unstated" ? "bottle" : size.size,
      sizeDetail: size.sizeDetail ?? "bottle",
    });
  }
  if (drop !== "no-category-word-nearby") return null;
  const size = sizeOf(line);
  if (size.size !== "pint" && size.size !== "keg" && size.size !== "bottle" && size.size !== "can") return null;
  return listedDrink(label, line, priceGbp, fact.sourceUrl, fact.seenOn, size);
}

function rememberDrink(drinks: ListedDrinkLine[], seenDrinks: Set<string>, row: ListedDrinkLine | null): void {
  if (!row) return;
  const key = `${row.drink.toLowerCase()}|${row.size}|${row.priceGbp}`;
  if (seenDrinks.has(key)) return;
  seenDrinks.add(key);
  drinks.push(row);
}

function recordPriceLine(
  line: string,
  fact: SourcedFact,
  drinks: ListedDrinkLine[],
  seenDrinks: Set<string>,
  dishes: FoodDish[],
  seenDishes: Set<string>,
): void {
  if (!line.includes("£")) return;
  for (const raw of findUkPriceCandidates(line)) {
    const outcome = decideKeylessUkPriceCandidate(line, raw);
    const label = drinkLabelFromPriceContext(line, raw.verbatim, raw.at) ?? "";
    if (isFoodEvidence(line, outcome)) {
      recordFoodDish(dishes, seenDishes, label, raw.priceGbp, fact);
      continue;
    }
    const row = outcome.kept
      ? listedDrink(outcome.kept.drinkLabel || label, line, outcome.kept.priceGbp, fact.sourceUrl, fact.seenOn)
      : drinkFromDrop(line, label, raw.priceGbp, outcome.drop, fact);
    rememberDrink(drinks, seenDrinks, row);
  }
}

function assemblePageFacts(
  markdown: string,
  rawLines: string[],
  fact: SourcedFact,
  drinks: ListedDrinkLine[],
  dishes: FoodDish[],
  amenities: AmenityFact[],
): PageFacts {
  const text = rawLines.join("\n");
  let served: boolean | null = null;
  if (NO_FOOD.test(text)) served = false;
  if (dishes.length > 0 || SERVES_FOOD.test(text)) served = true;
  const prices = dishes.map((dish) => dish.priceGbp);
  const hoursRead = parseStatedOpeningHours(markdown);
  const phoneMatch = PHONE_LINE.exec(text);
  const closureLine = rawLines.map((row) => row.trim()).find((row) => CLOSURE_LINE.test(row));
  return {
    drinks,
    food: {
      served,
      priceMinGbp: prices.length > 0 ? Math.min(...prices) : null,
      priceMaxGbp: prices.length > 0 ? Math.max(...prices) : null,
      dishes,
      sourceUrl: dishes[0]?.sourceUrl ?? (served === null ? null : fact.sourceUrl),
      seenOn: served === null && dishes.length === 0 ? null : fact.seenOn,
    },
    amenities,
    hours:
      hoursRead.statedDays.length > 0
        ? { statedDays: [...hoursRead.statedDays], sourceUrl: fact.sourceUrl, seenOn: fact.seenOn }
        : null,
    phone: phoneMatch ? { value: phoneMatch[1], sourceUrl: fact.sourceUrl, seenOn: fact.seenOn } : null,
    closure: closureLine
      ? { quote: closureLine.slice(0, 180), sourceUrl: fact.sourceUrl, seenOn: fact.seenOn }
      : null,
  };
}

export function factsFromPage(markdown: string, fact: SourcedFact): PageFacts {
  const drinks: ListedDrinkLine[] = [];
  const dishes: FoodDish[] = [];
  const amenities: AmenityFact[] = [];
  const seenDrinks = new Set<string>();
  const seenDishes = new Set<string>();
  const rawLines = String(markdown ?? "").split(/\r?\n/);

  for (const rawLine of rawLines) {
    const line = pageText(rawLine).replace(/\s+/g, " ").trim();
    if (!line) continue;
    recordAmenityMatches(amenities, line, fact);
    recordPriceLine(line, fact, drinks, seenDrinks, dishes, seenDishes);
  }

  return assemblePageFacts(markdown, rawLines, fact, drinks, dishes, amenities);
}

const FORBIDDEN_VENUE_KEYS = ["cheapestPrice", "contributorId", "contributor", "communityPrice", "confirmed"];

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function queueDocument(input: unknown): QueueDocument {
  if (typeof input !== "object" || input === null) throw new Error("A nightly queue is listed evidence.");
  const body = input as Record<string, unknown>;
  if (!Array.isArray(body.venues)) throw new Error("A nightly queue is listed evidence.");
  const venues: VenueEvidence[] = body.venues.map((row) => {
    if (typeof row !== "object" || row === null) throw new Error("A nightly queue price is listed.");
    const venue = row as Record<string, unknown>;
    for (const key of FORBIDDEN_VENUE_KEYS) {
      if (key in venue) throw new Error("A nightly queue price is listed, and a community price is refused.");
    }
    const drinksIn = Array.isArray(venue.drinks) ? venue.drinks : [];
    const drinks: ListedDrinkLine[] = drinksIn.map((drink) => {
      if (typeof drink !== "object" || drink === null) throw new Error("A nightly queue price is listed.");
      const price = drink as Record<string, unknown>;
      if (price.standing !== "listed") {
        throw new Error("A nightly queue price is listed. Confirmed is refused.");
      }
      if (typeof price.drink !== "string" || !isHttpUrl(price.sourceUrl)) {
        throw new Error("A nightly queue price is listed.");
      }
      if (typeof price.priceGbp !== "number" || !Number.isFinite(price.priceGbp)) {
        throw new Error("A nightly queue price is listed.");
      }
      return {
        drink: price.drink,
        size: price.size as DrinkSize,
        sizeDetail: typeof price.sizeDetail === "string" ? price.sizeDetail : null,
        priceGbp: price.priceGbp,
        standing: "listed",
        sourceUrl: price.sourceUrl,
        seenOn: String(price.seenOn ?? ""),
      };
    });
    const food = (typeof venue.food === "object" && venue.food !== null ? venue.food : emptyFood()) as FoodFacts;
    return {
      venueId: String(venue.venueId ?? ""),
      name: String(venue.name ?? ""),
      postcode: formatPostcode(String(venue.postcode ?? "")),
      borough: String(venue.borough ?? ""),
      seenOn: String(venue.seenOn ?? ""),
      website: venue.website && typeof venue.website === "object" ? (venue.website as VenueEvidence["website"]) : null,
      drinks,
      food: {
        served: food.served ?? null,
        priceMinGbp: food.priceMinGbp ?? null,
        priceMaxGbp: food.priceMaxGbp ?? null,
        dishes: Array.isArray(food.dishes) ? food.dishes : [],
        sourceUrl: food.sourceUrl ?? null,
        seenOn: food.seenOn ?? null,
      },
      amenities: Array.isArray(venue.amenities) ? (venue.amenities as AmenityFact[]) : [],
      hours: (venue.hours as VenueEvidence["hours"]) ?? null,
      phone: (venue.phone as VenueEvidence["phone"]) ?? null,
      closure: (venue.closure as VenueEvidence["closure"]) ?? null,
    };
  });
  return { version: 1, standingRule: "listed", venues };
}

export function mergeQueue(base: QueueDocument, incoming: readonly VenueEvidence[]): QueueDocument {
  const byKey = new Map<string, VenueEvidence>();
  for (const row of base.venues) byKey.set(venueKey(row), row);
  for (const row of incoming) byKey.set(venueKey(row), row);
  return queueDocument({ version: 1, venues: [...byKey.values()] });
}

function searchQueryFor(venue: NightlyVenue): string {
  const name = venue.name.replace(/[\r\n\t]+/g, " ").slice(0, 80).trim();
  return `"${name}" ${venue.postcode} ${venue.borough} pub drinks menu food`.replace(/\s+/g, " ").trim();
}

function pagesFromPayload(payload: unknown): Array<{ url: string; text: string }> {
  if (typeof payload !== "object" || payload === null) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const pages: Array<{ url: string; text: string }> = [];
  for (const result of results) {
    if (typeof result !== "object" || result === null) continue;
    const row = result as Record<string, unknown>;
    if (typeof row.url !== "string" || !isHarvestableOperatorUrl(row.url)) continue;
    const text = typeof row.raw_content === "string" && row.raw_content.trim()
      ? row.raw_content
      : typeof row.content === "string"
        ? row.content
        : "";
    if (!text.trim()) continue;
    pages.push({ url: row.url, text });
  }
  return pages;
}

function evidenceFor(
  venue: NightlyVenue,
  seenOn: string,
  website: string | null,
  pages: Array<{ url: string; text: string }>,
): VenueEvidence {
  const drinks: ListedDrinkLine[] = [];
  const dishes: FoodDish[] = [];
  const amenities: AmenityFact[] = [];
  let served: boolean | null = null;
  let hours: VenueEvidence["hours"] = null;
  let phone: VenueEvidence["phone"] = null;
  let closure: VenueEvidence["closure"] = null;
  const drinkKeys = new Set<string>();
  const dishKeys = new Set<string>();
  for (const page of pages) {
    const facts = factsFromPage(page.text, { sourceUrl: page.url, seenOn });
    for (const drink of facts.drinks) {
      const key = `${drink.drink.toLowerCase()}|${drink.size}|${drink.priceGbp}`;
      if (drinkKeys.has(key)) continue;
      drinkKeys.add(key);
      drinks.push(drink);
    }
    for (const dish of facts.food.dishes) {
      const key = `${dish.name.toLowerCase()}|${dish.priceGbp}`;
      if (dishKeys.has(key)) continue;
      dishKeys.add(key);
      dishes.push(dish);
    }
    if (facts.food.served === true) served = true;
    else if (facts.food.served === false && served !== true) served = false;
    for (const amenity of facts.amenities) {
      if (!amenities.some((row) => row.kind === amenity.kind && row.quote === amenity.quote)) amenities.push(amenity);
    }
    if (!hours && facts.hours) hours = facts.hours;
    if (!phone && facts.phone) phone = facts.phone;
    if (!closure && facts.closure) closure = facts.closure;
  }
  const prices = dishes.map((dish) => dish.priceGbp);
  return {
    venueId: venue.id,
    name: venue.name,
    postcode: formatPostcode(venue.postcode),
    borough: venue.borough,
    seenOn,
    website: website ? { url: website, sourceUrl: website, seenOn } : null,
    drinks,
    food: {
      served: dishes.length > 0 ? true : served,
      priceMinGbp: prices.length > 0 ? Math.min(...prices) : null,
      priceMaxGbp: prices.length > 0 ? Math.max(...prices) : null,
      dishes,
      sourceUrl: dishes[0]?.sourceUrl ?? null,
      seenOn: dishes.length > 0 || served !== null ? seenOn : null,
    },
    amenities,
    hours,
    phone,
    closure,
  };
}

export async function runNightlyPass(input: {
  venues: readonly NightlyVenue[];
  cursor: NightlyCursor;
  usage: unknown;
  now: Date;
  reserveCredits?: number;
  manualCap?: number | null;
  staleAfterDays?: number;
  fetchImpl: (request: NightlyRequest) => Promise<unknown>;
  queue: QueueDocument;
}): Promise<{ cursor: NightlyCursor; queue: QueueDocument; spent: number; stopped: "allowance" | "complete" }> {
  const today = isoDay(input.now);
  const allowance = tonightAllowance({
    usage: input.usage,
    now: input.now,
    reserveCredits: input.reserveCredits,
    manualCap: input.manualCap,
  });
  const ledger = openSpendLedger(allowance.credits);
  const selected = selectNightlyVenues(input.venues, input.cursor, {
    today,
    staleAfterDays: input.staleAfterDays ?? DEFAULT_STALE_DAYS,
    limit: input.venues.length,
  });
  let cursor = input.cursor;
  let queue = input.queue;
  let stopped: "allowance" | "complete" = "complete";

  for (const venue of selected) {
    if (!ledger.canSpend(SEARCH_CREDIT_COST)) {
      stopped = "allowance";
      break;
    }
    const search = await input.fetchImpl({ kind: "search", venueId: venue.id, query: searchQueryFor(venue) });
    ledger.record(Math.max(SEARCH_CREDIT_COST, reportedCredits(search, SEARCH_CREDIT_COST)));
    const hits = pagesFromPayload(search).map((page) => {
      const row = (Array.isArray((search as { results?: SearchHit[] }).results)
        ? (search as { results: SearchHit[] }).results.find((result) => result.url === page.url)
        : null);
      return { url: page.url, title: row?.title, content: page.text, description: row?.title };
    });
    const website = chooseOperatorUrl(hits, venue);
    const origin = website ? new URL(website).origin : "";
    const urls = website ? acceptedExtractUrls(hits.map((hit) => hit.url), origin) : [];
    const pages: Array<{ url: string; text: string }> = [];
    if (urls.length > 0 && ledger.canSpend(EXTRACT_CREDIT_COST)) {
      const extracted = await input.fetchImpl({ kind: "extract", venueId: venue.id, urls });
      ledger.record(Math.max(EXTRACT_CREDIT_COST, reportedCredits(extracted, EXTRACT_CREDIT_COST)));
      const byUrl = new Map(pagesFromPayload(extracted).map((page) => [page.url, page.text]));
      for (const url of urls) {
        const fromExtract = byUrl.get(url);
        const fromSearch = hits.find((hit) => hit.url === url)?.content;
        const text = fromExtract || fromSearch;
        if (text) pages.push({ url, text });
      }
    } else {
      for (const url of urls) {
        const text = hits.find((hit) => hit.url === url)?.content;
        if (text) pages.push({ url, text });
      }
    }
    queue = mergeQueue(queue, [evidenceFor(venue, today, website, pages)]);
    cursor = advanceCursor(cursor, [venue.id], today);
    if (ledger.exhausted) {
      const index = selected.findIndex((row) => row.id === venue.id);
      if (index >= 0 && index < selected.length - 1) stopped = "allowance";
      break;
    }
  }

  return { cursor, queue, spent: ledger.spent, stopped };
}

export function redactSecrets(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function integerFlag(name: string, raw: string | undefined, fallback: number | null, min: number): number | null {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from ${min}.`);
  return Number(raw);
}

export function parseNightlyArgs(argv: readonly string[]): NightlyArgs {
  return {
    dryRun: argv.includes("--dry-run"),
    manualCap: integerFlag("max-credits", readFlag(argv, "--max-credits"), null, 0),
    reserveCredits: integerFlag("reserve", readFlag(argv, "--reserve"), DEFAULT_RESERVE_CREDITS, 0) ?? DEFAULT_RESERVE_CREDITS,
    staleAfterDays: integerFlag("stale-days", readFlag(argv, "--stale-days"), DEFAULT_STALE_DAYS, 0) ?? DEFAULT_STALE_DAYS,
    usageFile: readFlag(argv, "--usage-file") ?? null,
  };
}
