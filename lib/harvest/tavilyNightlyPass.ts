// Nightly Tavily pass over the curated London index.
//
// The shared drink reader in lib/harvest/ukPriceCrawl.ts is asked whether a
// figure was stated. A stated serving it drops can still be queued. This
// module adds the night's budget, the resume cursor, and the Listed queue.
// A web price is evidence for a curator. It is never a Confirmed price and
// never a community price.

import {
  isOperatorHost,
  pickOperatorUrl,
  type OperatorSearchResult,
} from "@/lib/harvest/pubFacts";
import { isHarvestableOperatorUrl } from "@/lib/harvest/sourcePolicy";
import { isHttpUrl } from "@/lib/httpUrl";
import type { RobotsChecker } from "@/lib/harvest/robots";
import {
  CATEGORY_PRICE_BANDS,
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
const DAY_MS = 86_400_000;
const EXCERPT_MAX = 500;

const SEED_PATCHES = ["soho", "clapham", "shoreditch", "islington", "camden"] as const;
const THIN_BOROUGHS = new Set(["barking and dagenham", "kingston upon thames", "hounslow"]);

const VAGUE_NAME = /^(about|around|roughly|approximately|only|from|just|under|over)$/i;
const SERVING_WORD = "pints?|halves|half|schooners?|two[\\s-]thirds|kegs?|bottles?|cans?|glasses|glass|measures|measure";
const SERVING_SIZE = new RegExp(`\\b(?:${SERVING_WORD}|\\d{2,4}\\s*ml)\\b`, "i");
const POUR_OF = /^(?:(?:a|an)\s+)?(?:pints?|half|measures?|schooners?|two[\s-]thirds|glass(?:es)?|bottles?|cans?)\s+of\s+(?:(?:a|an)\s+)?(.+)$/i;
const FOOD_PATH = /(food|kitchen|lunch|dinner|brunch|\beat\b)/i;
const FOOD_PATH_EXCLUDE = /(privacy|cookie|terms|careers|login|account|basket|checkout)/i;
const DRINKS_PATH =
  /(?:^|[/?])(?:drinks?|bars?|tap-list|on-tap|cellar|price-list|tariff|beer|wine|cocktail)(?:\/|$|[?#])/i;
const DRINKS_LABEL = /\b(drinks?|bars?|beers?|wines?|cocktails?|ale|lager|stout|porter|cider|spirit|whisky|whiskey|gin|rum|vodka)\b/i;
const FOOD_LABEL = /\b(food|kitchen|lunch|dinner|brunch|\beat\b)/i;
const HEADING_FILLER = new Set(["and", "menu", "list"]);
const GLASS_ML = new Set(["125ml", "175ml", "250ml"]);
const SPIRIT_ML = new Set(["25ml", "35ml", "50ml"]);

type DrinkSize = "pint" | "keg" | "bottle" | "can" | "unstated";

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
  street: string;
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

type SourcedFact = {
  sourceUrl: string;
  seenOn: string;
  title?: string;
  boundSnippet?: boolean;
};

type CuratorExcerpt = {
  sourceUrl: string;
  seenOn: string;
  excerpt: string;
};

type PageFacts = {
  drinks: ListedDrinkLine[];
  excerpts: CuratorExcerpt[];
};

type VenueEvidence = {
  venueId: string;
  name: string;
  postcode: string;
  borough: string;
  seenOn: string;
  website: ({ url: string } & SourcedFact) | null;
  drinks: ListedDrinkLine[];
  excerpts: CuratorExcerpt[];
  candidates: string[];
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

function placeHaystack(venue: NightlyVenue): string {
  const search = venue.areaText.toLowerCase();
  const postcodeAt = postcodeHits(search)[0]?.index ?? -1;
  if (postcodeAt >= 0) return search.slice(0, postcodeAt);
  const borough = venue.borough.trim().toLowerCase();
  if (!borough) return search;
  const boroughAt = search.lastIndexOf(borough);
  if (boroughAt < 0) return search;
  return search.slice(0, boroughAt + borough.length);
}

function isSeed(venue: NightlyVenue): boolean {
  const borough = venue.borough.toLowerCase();
  const place = `${placeHaystack(venue)} ${venue.name}`.toLowerCase();
  return SEED_PATCHES.some((seed) => borough === seed || wordHit(borough, seed) || wordHit(place, seed));
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

function unspacedPostcode(compact: string): string | null {
  if (compact.length < 5 || compact.length > 7) return null;
  const inward = compact.slice(-3);
  const outward = compact.slice(0, -3);
  if (!/^\d[A-Z]{2}$/.test(inward) || !/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward)) return null;
  if (/^[A-Z]{1,2}\d$/.test(outward)) return null;
  return outward + inward;
}

function postcodeHits(text: string): Array<{ compact: string; index: number }> {
  const hits: Array<{ compact: string; index: number }> = [];
  for (const match of text.matchAll(/\b([A-Z]{1,2}\d[A-Z\d]?)\s+(\d[A-Z]{2})\b/gi)) {
    const outward = (match[1] ?? "").toUpperCase();
    const inward = (match[2] ?? "").toUpperCase();
    if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) || !/^\d[A-Z]{2}$/.test(inward)) continue;
    hits.push({ compact: outward + inward, index: match.index ?? 0 });
  }
  for (const match of text.matchAll(/\b[A-Z0-9]{5,7}\b/gi)) {
    const compact = unspacedPostcode(match[0].toUpperCase());
    if (!compact) continue;
    hits.push({ compact, index: match.index ?? 0 });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

function compactPostcodesIn(text: string): string[] {
  return postcodeHits(text).map((hit) => hit.compact);
}

function statesPostcode(text: string, postcode: string): boolean {
  const wanted = compactPostcode(postcode);
  if (!wanted) return false;
  return compactPostcodesIn(text).includes(wanted);
}

function phraseWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function hasRoadName(words: readonly string[]): boolean {
  return words.some((word) => /[a-z]/.test(word));
}

function stripAddressNoise(text: string): string {
  return text.replace(/£\s*\d+(?:\.\d+)?/g, " ").replace(/\d+\.\d+/g, " ");
}

function sentenceChunks(text: string): string[] {
  const cleaned = stripAddressNoise(text);
  return cleaned
    .split(/(?<![a-z]{1,2})\./gi)
    .flatMap((chunk) => chunk.split(/[!?]+/))
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function statesStreet(text: string, street: string): boolean {
  const words = phraseWords(street);
  if (words.length < 2 || !/^\d/.test(words[0] ?? "") || !hasRoadName(words)) return false;
  const body = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const pattern = new RegExp(`(?:^|\\s)${body}(?:\\s|$)`);
  return sentenceChunks(text).some((sentence) => {
    const hay = phraseWords(sentence).join(" ");
    return pattern.test(hay);
  });
}

function streetFromSearchText(name: string, searchText: string): string {
  let rest = searchText.trim().toLowerCase();
  const nameLower = name.trim().toLowerCase();
  const variants = [nameLower];
  if (nameLower.startsWith("the ")) variants.push(nameLower.slice(4));
  let stripped = false;
  for (const variant of variants) {
    if (variant.length > 0 && rest.startsWith(variant)) {
      rest = rest.slice(variant.length).trim();
      stripped = true;
      break;
    }
  }
  if (!stripped) return "";
  const at = postcodeHits(rest)[0]?.index ?? -1;
  const beforePostcode = (at >= 0 ? rest.slice(0, at) : rest).replace(/[,\s]+$/g, "");
  const fields = beforePostcode.split(",").map((field) => phraseWords(field).join(" ")).filter(Boolean);
  for (const [index, field] of fields.entries()) {
    const words = field.split(" ");
    if (!/^\d/.test(words[0] ?? "")) continue;
    let line = field;
    if (!hasRoadName(words)) {
      const next = fields[index + 1] ?? "";
      if (!hasRoadName(phraseWords(next))) continue;
      line = `${line} ${next}`;
    }
    if (line.length < 4) continue;
    return line;
  }
  return "";
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
  const found = postcodeHits(searchText)[0];
  const price = record.cheapestPrice;
  return {
    id: record.id,
    name: record.name,
    postcode: found ? formatPostcode(found.compact) : "",
    street: streetFromSearchText(record.name, searchText),
    borough: typeof record.borough === "string" ? record.borough : "",
    areaText: searchText,
    priced: typeof price === "number" && Number.isFinite(price) && price > 0,
  };
}

function resultStatesVenue(result: SearchHit, venue: { postcode: string; street?: string }): boolean {
  const text = `${result.title ?? ""} ${result.description ?? ""} ${result.content ?? ""}`;
  if (statesPostcode(text, venue.postcode)) return true;
  const wanted = compactPostcode(venue.postcode);
  if (compactPostcodesIn(text).some((code) => code !== wanted)) return false;
  return statesStreet(text, venue.street ?? "");
}

export function chooseOperatorUrl(
  results: readonly SearchHit[],
  venue: { name: string; postcode: string; street?: string },
): string | null {
  const eligible = results.filter((result) => isOperatorHost(result.url) && isHarvestableOperatorUrl(result.url));
  const narrowed = eligible.filter((result) => resultStatesVenue(result, venue));
  return pickOperatorUrl(narrowed, venue.name) ?? narrowed[0]?.url ?? null;
}

function sameListedUrl(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

function pushListedPage(
  pages: Array<{ url: string; title?: string; text: string; boundSnippet?: boolean }>,
  url: string,
  text: string | undefined,
  title?: string,
  boundSnippet = false,
): void {
  if (!text?.trim()) return;
  if (pages.some((page) => sameListedUrl(page.url, url))) return;
  pages.push({ url, title, text, boundSnippet });
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
  const poured = label.replace(/^[/|\s]+/, "").trim().match(POUR_OF);
  const source = poured?.[1]?.trim() ?? label;
  const cleaned = source
    .replace(/\bschooners?\b(?:\s*\([^)]*\))?/gi, " ")
    .replace(/\btwo[\s-]thirds\b(?:\s+of\s+a)?(?:\s+pints?\b)?/gi, " ")
    .replace(/(?:⅔|\b2\/3\b)(?:\s+of\s+a)?(?:\s+pints?\b)?/gi, " ")
    .replace(/(?:½|\b1\/2\b)(?:\s+of\s+a)?(?:\s+pints?\b)?/gi, " ")
    .replace(/\b\d{2,4}\s*ml\b/gi, " ")
    .replace(new RegExp(`\\b(?:${SERVING_WORD})(?:\\s+of(?:\\s+a)?)?\\b`, "gi"), " ")
    .replace(/[/|]+/g, (mark, offset, source) => (
      mark === "/"
      && /(?:19|20)\d{2}$/.test(source.slice(Math.max(0, offset - 4), offset))
      && /^\d{2}(?!\d)/.test(source.slice(offset + 1))
        ? "/"
        : " "
    ))
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "")
    .trim();
  if (cleaned.length < 2 || VAGUE_NAME.test(cleaned)) return null;
  return cleaned;
}

function isMixedNumber(line: string): boolean {
  return /\d\s*[½⅓⅔¼¾]\s*pints?\b/i.test(line)
    || /\d[ \t]+1\/2\s*pints?\b/i.test(line);
}

function sizeOf(line: string): { size: DrinkSize; sizeDetail: string | null } {
  if (/\bschooners?\b/i.test(line)) return { size: "unstated", sizeDetail: "schooner" };
  if (/\btwo[\s-]thirds\b/i.test(line) || /(?<!\d)⅔|(?<!\d)\b2\/3\b/.test(line)) {
    return { size: "unstated", sizeDetail: "two-thirds" };
  }
  if (/(?<!\d)(?:½|\b1\/2\b|\bhalf)[\s-]+bottles?\b/i.test(line)) {
    return { size: "unstated", sizeDetail: "half bottle" };
  }
  if (/(?<!\d)(?:½|\b1\/2\b)|\bhalf\b/i.test(line)) {
    return { size: "unstated", sizeDetail: "half" };
  }
  if (/\b568\s*ml\b/i.test(line) || /\bpints?\b/i.test(line)) return { size: "pint", sizeDetail: "pint" };
  const ml = /\b(\d{2,4})\s*ml\b/i.exec(line);
  const detail = ml ? `${ml[1]}ml` : null;
  if (detail && SPIRIT_ML.has(detail)) return { size: "unstated", sizeDetail: detail };
  if (/\bcans?\b/i.test(line)) return { size: "can", sizeDetail: detail ?? "can" };
  if (/\bkeg\b/i.test(line)) return { size: "keg", sizeDetail: detail };
  if (/\bbottles?\b/i.test(line)) return { size: "bottle", sizeDetail: detail ?? "bottle" };
  if (detail && GLASS_ML.has(detail)) return { size: "unstated", sizeDetail: detail };
  if (detail) return { size: "unstated", sizeDetail: detail };
  return { size: "unstated", sizeDetail: null };
}

function measureAllowed(line: string, size: { size: DrinkSize; sizeDetail: string | null }): boolean {
  if (isMixedNumber(line)) return false;
  if (size.size === "pint" || size.size === "keg" || size.size === "bottle" || size.size === "can") return true;
  if (size.sizeDetail === "half" || size.sizeDetail === "half bottle" || size.sizeDetail === "schooner" || size.sizeDetail === "two-thirds") return true;
  if (size.sizeDetail && (GLASS_ML.has(size.sizeDetail) || SPIRIT_ML.has(size.sizeDetail))) return true;
  if (/\b\d{2,4}\s*ml\b/i.test(line)) return true;
  return /\b(?:glasses|glass)\b/i.test(line);
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
  band: { minGbp: number; maxGbp: number } = { minGbp: BEER_MIN_GBP, maxGbp: BEER_MAX_GBP },
): ListedDrinkLine | null {
  const drink = cleanName(name);
  if (!drink || !inBand(priceGbp, band.minGbp, band.maxGbp)) return null;
  const size = forced ?? sizeOf(line);
  if (!measureAllowed(line, size)) return null;
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

type PriceOutcome = ReturnType<typeof decideKeylessUkPriceCandidate>;

function measureTail(after: string): string {
  return new RegExp(`^(?:\\s*\\/\\s*|\\s+)(?:${SERVING_WORD}|\\d{2,4}\\s*ml)\\b`, "i").exec(after)?.[0] ?? "";
}

function trailingMeasure(after: string): string {
  const next = /£/.exec(after);
  const untilNext = next ? after.slice(0, next.index) : after;
  const tail = measureTail(untilNext);
  if (next && untilNext.trim() === tail.trim()) return "";
  return tail;
}

function isBareGlassMeasure(text: string): boolean {
  const detail = text.replace(/^[/|\s]+/, "").trim().replace(/\s+/g, "").toLowerCase();
  return GLASS_ML.has(detail);
}

function namedLabel(line: string, at: number, local: string): string {
  if (cleanName(local)) return local;
  const ownMeasure = local.replace(/^[/|\s]+/, "").trim();
  let cursor = at;
  for (let hop = 0; hop < 4; hop += 1) {
    const before = line.slice(0, cursor);
    const prior = [...before.matchAll(/£\s?\d{1,2}(?:\.\d{2})?\b/g)].at(-1);
    if (!prior || prior.index === undefined) return local;
    const between = before.slice(prior.index + prior[0].length);
    if (/(?:\. |; )/.test(between)) return local;
    const crossedPipe = /(?: \| |\|\s)/.test(between);
    if (crossedPipe && !isBareGlassMeasure(ownMeasure)) return local;
    const priorLabel = drinkLabelFromPriceContext(line, prior[0], prior.index) ?? "";
    const priorName = cleanName(priorLabel);
    const priorMl = /\b(\d{2,4})\s*ml\b/i.exec(priorLabel);
    if (crossedPipe && priorName && !(priorMl && GLASS_ML.has(`${priorMl[1]}ml`))) return local;
    if (priorName) return ownMeasure ? `${priorName} ${ownMeasure}` : priorName;
    if (!isBareGlassMeasure(priorLabel)) return local;
    cursor = prior.index;
  }
  return local;
}

function ownPrice(line: string, verbatim: string, at: number): { text: string; at: number; label: string } {
  const local = drinkLabelFromPriceContext(line, verbatim, at) ?? "";
  const label = namedLabel(line, at, local);
  const tail = trailingMeasure(line.slice(at + verbatim.length));
  const prefix = label ? `${label} ` : "";
  return { label, text: `${prefix}${verbatim}${tail}`, at: prefix.length };
}

function drinkFromDrop(
  line: string,
  label: string,
  priceGbp: number,
  drop: PriceOutcome["drop"],
  fact: SourcedFact,
): ListedDrinkLine | null {
  if (drop === "bottled-measure-not-a-pint" || drop === "half-measure-not-a-pint") {
    return listedDrink(label, line, priceGbp, fact.sourceUrl, fact.seenOn, sizeOf(line));
  }
  if (drop !== "no-category-word-nearby") return null;
  const size = sizeOf(line);
  if (size.size === "unstated" && !size.sizeDetail) return null;
  return listedDrink(label, line, priceGbp, fact.sourceUrl, fact.seenOn, size);
}

function listedDrinkKey(row: { drink: string; size: string; sizeDetail: string | null; priceGbp: number }): string {
  return `${row.drink.toLowerCase()}|${row.size}|${row.sizeDetail ?? ""}|${row.priceGbp}`;
}

function rememberDrink(drinks: ListedDrinkLine[], seenDrinks: Set<string>, row: ListedDrinkLine | null): void {
  if (!row) return;
  const key = listedDrinkKey(row);
  if (seenDrinks.has(key)) return;
  seenDrinks.add(key);
  drinks.push(row);
}

const JOINED_SIZE_LIST = /(?<![\d/.£])\d{2,4}(?:\s*ml)?(?:\s*\/\s*\d{2,4}(?:\s*ml)?)+(?!\s*\/\s*\d)/gi;
const JOINED_PRICE_LIST = /^\s*((?:£\s?\d{1,2}(?:\.\d{2})?)(?:\s*\/\s*£\s?\d{1,2}(?:\.\d{2})?)*)/;
const LEADING_MEASURE = new RegExp(`^(?:${SERVING_WORD}|\\d{2,4}\\s*ml|½|1\\/2|2\\/3|⅔)\\b`, "i");

function isNewDrinkName(text: string): boolean {
  const body = text.replace(/^[/|\s]+/, "");
  if (!body || /^£/.test(body)) return false;
  const head = (body.split("£")[0] ?? "").trim();
  if (POUR_OF.test(head)) return true;
  if (LEADING_MEASURE.test(body)) return false;
  const name = cleanName(head);
  return Boolean(name && /[A-Za-z]/.test(name));
}

function splitPriceItems(line: string): string[] {
  const splits: Array<{ sepStart: number; nextStart: number }> = [];
  const consider = (sepStart: number, nextStart: number) => {
    if (nextStart > sepStart && isNewDrinkName(line.slice(nextStart))) splits.push({ sepStart, nextStart });
  };
  for (const match of line.matchAll(/(?<=\d)[.!?]\s+|(?<=[a-z]{3})[.!?]\s+|;\s+/gi)) {
    consider(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  for (const match of line.matchAll(/\s*\|\s*/g)) {
    consider(match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  for (const match of line.matchAll(/£\s?\d{1,2}(?:\.\d{2})?(?:\s*\/\s*£\s?\d{1,2}(?:\.\d{2})?)*/g)) {
    const after = (match.index ?? 0) + match[0].length;
    const lead = /^,?\s+/.exec(line.slice(after));
    if (!lead) continue;
    const nextStart = after + lead[0].length;
    if (/^[.!?;|]/.test(line.slice(nextStart))) continue;
    consider(after, nextStart);
  }
  splits.sort((a, b) => a.sepStart - b.sepStart || a.nextStart - b.nextStart);
  const items: string[] = [];
  let cursor = 0;
  for (const split of splits) {
    if (split.sepStart < cursor) continue;
    const item = line.slice(cursor, split.sepStart).trim();
    if (item) items.push(item);
    cursor = split.nextStart;
  }
  const rest = line.slice(cursor).trim();
  if (rest) items.push(rest);
  return items.length > 0 ? items : [line];
}

function pairedMeasureLines(line: string): string[] | null {
  const parts: string[] = [];
  let carried = "";
  let saw = false;
  let cursor = 0;
  for (const match of line.matchAll(JOINED_SIZE_LIST)) {
    if (match.index === undefined || match.index < cursor || !/ml/i.test(match[0])) continue;
    const sizes = [...match[0].matchAll(/\d{2,4}/g)].map((token) => `${token[0]}ml`);
    const priceMatch = JOINED_PRICE_LIST.exec(line.slice(match.index + match[0].length));
    const prices = priceMatch
      ? [...(priceMatch[1] ?? "").matchAll(/£\s?\d{1,2}(?:\.\d{2})?/g)].map((token) => token[0].replace(/\s+/g, ""))
      : [];
    if (!priceMatch || prices.length !== sizes.length) {
      const before = line.slice(cursor, match.index).trim();
      if (before.includes("£")) parts.push(before);
      saw = true;
      const consumed = priceMatch ? priceMatch[0].length : 0;
      cursor = match.index + match[0].length + consumed;
      continue;
    }
    saw = true;
    const name = line.slice(cursor, match.index).replace(/\s+/g, " ").trim();
    carried = name;
    for (let i = 0; i < sizes.length; i += 1) {
      parts.push(`${name} ${sizes[i]} ${prices[i]}`.replace(/\s+/g, " ").trim());
    }
    cursor = match.index + match[0].length + priceMatch[0].length;
  }
  if (!saw) return null;
  const tail = line.slice(cursor).trim();
  if (tail) {
    const named = isNewDrinkName(tail) ? tail : `${carried} ${tail}`;
    parts.push(named.replace(/\s+/g, " ").trim());
  }
  return parts;
}

function recordPriceLine(
  line: string,
  fact: SourcedFact,
  drinks: ListedDrinkLine[],
  seenDrinks: Set<string>,
): void {
  const items = splitPriceItems(line);
  if (items.length > 1) {
    for (const item of items) recordPriceLine(item, fact, drinks, seenDrinks);
    return;
  }
  const paired = pairedMeasureLines(line);
  if (paired) {
    for (const part of paired) recordPriceLine(part, fact, drinks, seenDrinks);
    return;
  }
  if (!line.includes("£")) return;
  for (const raw of findUkPriceCandidates(line)) {
    const own = ownPrice(line, raw.verbatim, raw.at);
    if (!SERVING_SIZE.test(own.text)) continue;
    const outcome = decideKeylessUkPriceCandidate(own.text, { ...raw, at: own.at });
    const row = outcome.kept
      ? listedDrink(
          outcome.kept.drinkLabel || own.label,
          own.text,
          outcome.kept.priceGbp,
          fact.sourceUrl,
          fact.seenOn,
          undefined,
          CATEGORY_PRICE_BANDS[outcome.kept.category] ?? { minGbp: BEER_MIN_GBP, maxGbp: BEER_MAX_GBP },
        )
      : drinkFromDrop(own.text, own.label, raw.priceGbp, outcome.drop, fact);
    rememberDrink(drinks, seenDrinks, row && line.includes(row.drink) ? row : null);
  }
}

type MenuKind = "drinks" | "food" | "both";

function menuKind(value: string): MenuKind | null {
  const food = FOOD_LABEL.test(value);
  const drinks = DRINKS_LABEL.test(value);
  if (food && drinks) return "both";
  if (food) return "food";
  if (drinks) return "drinks";
  return null;
}

function saysMenu(kind: MenuKind | null, want: "food" | "drinks"): boolean {
  return kind === want || kind === "both";
}

function headingKind(line: string): "drinks" | "food" | null {
  const text = line.replace(/^#{1,6}\s+/, "").replace(/[*_`]+/g, "").trim();
  if (!text || /[£\d.!?]/.test(text)) return null;
  const words = phraseWords(text);
  if (words.length === 0 || words.length > 4) return null;
  const content = words.filter((word) => !HEADING_FILLER.has(word));
  if (content.length === 0) return null;
  const hasFood = content.some((word) => FOOD_LABEL.test(word));
  const hasDrinks = content.some((word) => DRINKS_LABEL.test(word));
  if (hasDrinks && (!hasFood || content.every((word) => FOOD_LABEL.test(word) || DRINKS_LABEL.test(word)))) return "drinks";
  if (hasFood && content.every((word) => FOOD_LABEL.test(word))) return "food";
  return null;
}

function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function pathIsDrinksMenu(path: string): boolean {
  if (DRINKS_PATH.test(path)) return true;
  return saysMenu(menuKind(path), "drinks");
}

function pathIsFoodOnly(path: string): boolean {
  if (FOOD_PATH_EXCLUDE.test(path)) return false;
  if (FOOD_PATH.test(path) && !pathIsDrinksMenu(path)) return true;
  const kind = menuKind(path);
  return saysMenu(kind, "food") && !saysMenu(kind, "drinks");
}

function pricesAllowed(
  url: string,
  title: string | undefined,
  section: "drinks" | "food" | null,
  boundSnippet = false,
): boolean {
  const path = urlPath(url);
  const pathKind = menuKind(path);
  const titleKind = title ? menuKind(title) : null;
  const drinksPath = pathIsDrinksMenu(path) || saysMenu(pathKind, "drinks");
  const drinksTitle = saysMenu(titleKind, "drinks");
  const drinksHeading = section === "drinks";
  const foodOnlyPath = pathIsFoodOnly(path);
  const foodOnlyHeading = section === "food";
  if ((boundSnippet || drinksPath || drinksTitle || drinksHeading) && !foodOnlyPath && !foodOnlyHeading) return true;
  if (foodOnlyPath || foodOnlyHeading || saysMenu(pathKind, "food") || saysMenu(titleKind, "food")) return false;
  return false;
}

function pageExcerpt(markdown: string): string {
  const text = String(markdown ?? "").trim();
  if (!text) return "";
  return text.length <= EXCERPT_MAX ? text : text.slice(0, EXCERPT_MAX).trimEnd();
}

export function factsFromPage(markdown: string, fact: SourcedFact): PageFacts {
  const drinks: ListedDrinkLine[] = [];
  const seenDrinks = new Set<string>();
  const rawLines = String(markdown ?? "").split(/\r?\n/);
  let section: "drinks" | "food" | null = null;

  for (const rawLine of rawLines) {
    const line = pageText(rawLine).replace(/\s+/g, " ").trim();
    if (!line) continue;
    const headed = headingKind(line);
    if (headed) {
      section = headed;
      continue;
    }
    if (pricesAllowed(fact.sourceUrl, fact.title, section, fact.boundSnippet)) {
      recordPriceLine(line, fact, drinks, seenDrinks);
    }
  }

  const excerpt = pageExcerpt(markdown);
  return {
    drinks,
    excerpts: excerpt ? [{ sourceUrl: fact.sourceUrl, excerpt, seenOn: fact.seenOn }] : [],
  };
}

const FORBIDDEN_VENUE_KEYS = ["cheapestPrice", "contributorId", "contributor", "communityPrice", "confirmed"];

function isHttpUrlWithoutUserInfo(value: unknown): value is string {
  if (!isHttpUrl(value, { allowWhitespace: true })) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
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
      if (typeof price.drink !== "string" || !isHttpUrlWithoutUserInfo(price.sourceUrl)) {
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
    const excerptsIn = Array.isArray(venue.excerpts) ? venue.excerpts : [];
    const excerpts: CuratorExcerpt[] = [];
    for (const row of excerptsIn) {
      if (typeof row !== "object" || row === null) continue;
      const item = row as Record<string, unknown>;
      if (!isHttpUrlWithoutUserInfo(item.sourceUrl) || typeof item.excerpt !== "string") continue;
      const excerpt = item.excerpt.trim().slice(0, EXCERPT_MAX);
      if (!excerpt) continue;
      excerpts.push({
        sourceUrl: item.sourceUrl,
        excerpt,
        seenOn: typeof item.seenOn === "string" ? item.seenOn : "",
      });
    }
    return {
      venueId: String(venue.venueId ?? ""),
      name: String(venue.name ?? ""),
      postcode: formatPostcode(String(venue.postcode ?? "")),
      borough: String(venue.borough ?? ""),
      seenOn: String(venue.seenOn ?? ""),
      website: venue.website && typeof venue.website === "object" ? (venue.website as VenueEvidence["website"]) : null,
      drinks,
      excerpts,
      candidates: Array.isArray(venue.candidates) ? venue.candidates.filter((url): url is string => isHttpUrlWithoutUserInfo(url)) : [],
    };
  });
  return { version: 1, standingRule: "listed", venues };
}

function unionBy<T>(previous: readonly T[], incoming: readonly T[], keyOf: (row: T) => string): T[] {
  const seen = new Set(previous.map(keyOf));
  const out = [...previous];
  for (const row of incoming) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function keepListedLines(previous: VenueEvidence | undefined, incoming: VenueEvidence): VenueEvidence {
  if (!previous) return incoming;
  const drinks = unionBy(
    previous.drinks,
    incoming.drinks,
    (row) => listedDrinkKey(row),
  );
  const excerpts = unionBy(previous.excerpts, incoming.excerpts, (row) => `${row.sourceUrl}|${row.excerpt}`);
  const website = incoming.website ?? previous.website;
  const candidates = website
    ? []
    : incoming.candidates.length > 0
      ? incoming.candidates
      : previous.candidates;
  return { ...incoming, drinks, excerpts, candidates, website };
}

export function mergeQueue(base: QueueDocument, incoming: readonly VenueEvidence[]): QueueDocument {
  const byKey = new Map<string, VenueEvidence>();
  for (const row of base.venues) byKey.set(venueKey(row), row);
  for (const row of incoming) {
    const key = venueKey(row);
    byKey.set(key, keepListedLines(byKey.get(key), row));
  }
  return queueDocument({ version: 1, venues: [...byKey.values()] });
}

function searchQueryFor(venue: NightlyVenue): string {
  const name = venue.name.replace(/[\r\n\t]+/g, " ").slice(0, 80).trim();
  return `"${name}" ${venue.postcode} ${venue.borough} pub drinks menu food`.replace(/\s+/g, " ").trim();
}

function responseFailed(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return true;
  const body = payload as Record<string, unknown>;
  const error = body.error;
  if (typeof error === "string" && error.trim().length > 0) return true;
  if (typeof error === "object" && error !== null) return true;
  return "results" in body && !Array.isArray(body.results);
}

function pagesFromPayload(payload: unknown, keepEmpty = false): Array<{ url: string; title?: string; text: string }> {
  if (typeof payload !== "object" || payload === null) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const pages: Array<{ url: string; title?: string; text: string }> = [];
  for (const result of results) {
    if (typeof result !== "object" || result === null) continue;
    const row = result as Record<string, unknown>;
    if (typeof row.url !== "string" || !isHarvestableOperatorUrl(row.url)) continue;
    const text = typeof row.raw_content === "string" && row.raw_content.trim()
      ? row.raw_content
      : typeof row.content === "string"
        ? row.content
        : "";
    if (!text.trim() && !keepEmpty) continue;
    pages.push({ url: row.url, title: typeof row.title === "string" ? row.title : undefined, text });
  }
  return pages;
}

function evidenceFor(
  venue: NightlyVenue,
  seenOn: string,
  website: string | null,
  pages: Array<{ url: string; title?: string; text: string; boundSnippet?: boolean }>,
  candidates: readonly string[],
): VenueEvidence {
  const drinks: ListedDrinkLine[] = [];
  const excerpts: CuratorExcerpt[] = [];
  const drinkKeys = new Set<string>();
  const excerptKeys = new Set<string>();
  for (const page of pages) {
    const facts = factsFromPage(page.text, {
      sourceUrl: page.url,
      seenOn,
      title: page.title,
      boundSnippet: page.boundSnippet,
    });
    for (const drink of facts.drinks) {
      const key = listedDrinkKey(drink);
      if (drinkKeys.has(key)) continue;
      drinkKeys.add(key);
      drinks.push(drink);
    }
    for (const excerpt of facts.excerpts) {
      const key = `${excerpt.sourceUrl}|${excerpt.excerpt}`;
      if (excerptKeys.has(key)) continue;
      excerptKeys.add(key);
      excerpts.push(excerpt);
    }
  }
  return {
    venueId: venue.id,
    name: venue.name,
    postcode: formatPostcode(venue.postcode),
    borough: venue.borough,
    seenOn,
    website: website ? { url: website, sourceUrl: website, seenOn } : null,
    drinks,
    excerpts,
    candidates: [...candidates],
  };
}

async function takePayload(
  ledger: SpendLedger,
  cost: number,
  run: () => Promise<unknown>,
): Promise<unknown | null> {
  let payload: unknown;
  try {
    payload = await run();
  } catch {
    ledger.record(cost);
    return null;
  }
  ledger.record(Math.max(cost, reportedCredits(payload, cost)));
  return payload;
}

async function robotsAllowedUrls(urls: readonly string[], robots: RobotsChecker): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    if (!isHarvestableOperatorUrl(url)) continue;
    let decision;
    try {
      decision = await robots(url);
    } catch {
      continue;
    }
    if (decision.allowed) out.push(url);
  }
  return out;
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
  robotsChecker?: RobotsChecker;
  persist?: (state: { queue: QueueDocument; cursor: NightlyCursor }) => void | Promise<void>;
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
    const search = await takePayload(ledger, SEARCH_CREDIT_COST, () =>
      input.fetchImpl({ kind: "search", venueId: venue.id, query: searchQueryFor(venue) }),
    );
    if (!search || responseFailed(search)) {
      if (ledger.exhausted) stopped = "allowance";
      if (ledger.exhausted) break;
      continue;
    }
    const searched = pagesFromPayload(search, true);
    const permittedUrls = input.robotsChecker
      ? await robotsAllowedUrls(searched.map((page) => page.url), input.robotsChecker)
      : searched.map((page) => page.url).filter((url) => isHarvestableOperatorUrl(url));
    const permitted = new Set(permittedUrls);
    const hits = searched
      .filter((page) => permitted.has(page.url))
      .map((page) => ({
        url: page.url,
        title: page.title,
        content: page.text,
        description: page.title,
      }));
    const website = chooseOperatorUrl(hits, venue);
    const origin = website ? new URL(website).origin : "";
    const candidateUrls = website ? acceptedExtractUrls(hits.map((hit) => hit.url), origin) : [];
    const urls = candidateUrls.filter((url) => permitted.has(url));
    const pages: Array<{ url: string; title?: string; text: string; boundSnippet?: boolean }> = [];
    let extractAttempted = false;
    if (urls.length > 0 && ledger.canSpend(EXTRACT_CREDIT_COST)) {
      extractAttempted = true;
      const extracted = await takePayload(ledger, EXTRACT_CREDIT_COST, () =>
        input.fetchImpl({ kind: "extract", venueId: venue.id, urls }),
      );
      if (!extracted) {
        if (ledger.exhausted) stopped = "allowance";
        if (ledger.exhausted) break;
        continue;
      }
      if (!responseFailed(extracted)) {
        const extractedPages = pagesFromPayload(extracted);
        for (const url of urls) {
          const extractedPage = extractedPages.find((page) => sameListedUrl(page.url, url));
          if (!extractedPage?.text.trim()) continue;
          const hit = hits.find((row) => sameListedUrl(row.url, url));
          pushListedPage(pages, url, extractedPage.text, extractedPage.title ?? hit?.title);
        }
      }
    }
    if (
      website
      && permitted.has(website)
      && (urls.length === 0 || extractAttempted)
      && !pages.some((page) => sameListedUrl(page.url, website))
    ) {
      const hit = hits.find((row) => sameListedUrl(row.url, website));
      pushListedPage(pages, website, hit?.content, hit?.title, true);
    }
    const candidates = website
      ? []
      : [...new Set(hits.filter((hit) => isOperatorHost(hit.url)).map((hit) => hit.url))];
    const evidence = evidenceFor(venue, today, website, pages, candidates);
    queue = mergeQueue(queue, [evidence]);
    const stored = Boolean(evidence.website) || evidence.excerpts.length > 0 || evidence.drinks.length > 0;
    const extractedText = pages.some((page) => !page.boundSnippet);
    const returnedResults = Array.isArray((search as { results?: unknown }).results)
      ? (search as { results: unknown[] }).results.length
      : 0;
    const refusedBinding = searched.some((page) => !permitted.has(page.url) && resultStatesVenue({
      url: page.url,
      title: page.title,
      content: page.text,
      description: page.title,
    }, venue));
    const unboundSearch = !website && returnedResults > 0 && !refusedBinding;
    if (((extractedText || urls.length === 0) && stored) || unboundSearch) {
      cursor = advanceCursor(cursor, [venue.id], today);
    }
    if (input.persist) await input.persist({ queue, cursor });
    if (ledger.exhausted) {
      const index = selected.findIndex((row) => row.id === venue.id);
      if (index >= 0 && index < selected.length - 1) stopped = "allowance";
      break;
    }
  }

  return { cursor, queue, spent: ledger.spent, stopped };
}

export async function saveNightlyProgress(
  state: { queue: QueueDocument; cursor: NightlyCursor },
  write: {
    queue: (queue: QueueDocument) => void | Promise<void>;
    cursor: (cursor: NightlyCursor) => void | Promise<void>;
  },
): Promise<void> {
  await write.queue(state.queue);
  await write.cursor(state.cursor);
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
