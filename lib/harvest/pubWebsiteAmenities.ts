// Amenity claims taken from a pub's own website.
//
// A true value is kept only when the model quotes a phrase that is actually on
// the page. The quote is the evidence. A blank price-dataset column is the
// existing amenity path, so a kept value stamps that column as "yes" and leaves
// a column the source already answered alone.

import { haversineMeters } from "../greatCircle.mjs";

export const PUB_WEBSITE_AMENITY_KEYS = [
  "food",
  "cocktails",
  "beerGarden",
  "liveSports",
  "nonAlcoholic",
  "liveMusic",
  "pubQuiz",
  "darts",
  "pool",
  "happyHour",
  "karaoke",
] as const;

export type PubWebsiteAmenityKey = (typeof PUB_WEBSITE_AMENITY_KEYS)[number];

/** Column on a pint-price row. `nonAlcoholic` has no legacy column of that name. */
export const PUB_WEBSITE_AMENITY_COLUMNS: Record<PubWebsiteAmenityKey, string> = {
  food: "food",
  cocktails: "cocktails",
  beerGarden: "beer_garden",
  liveSports: "live_sports",
  nonAlcoholic: "non_alcoholic",
  liveMusic: "live_music",
  pubQuiz: "pub_quiz",
  darts: "darts",
  pool: "pool",
  happyHour: "happy_hour",
  karaoke: "karaoke",
};

export const MIN_EVIDENCE_CHARS = 8;
export const MAX_EVIDENCE_CHARS = 280;
export const PAGE_CHAR_CAP = 12_000;
export const MAX_OUTPUT_TOKENS = 700;
export const JOB_SPEND_CAP_USD = 20;
export const MATCH_METRES = 120;

/**
 * Gemini 2.5 Flash-Lite standard paid tier, text, from the Gemini API pricing
 * page read on 2026-10-03. Output includes thinking tokens. No search grounding.
 */
export const FLASH_LITE_SKU = {
  model: "gemini-2.5-flash-lite",
  inputUsdPerMillion: 0.1,
  outputUsdPerMillion: 0.4,
} as const;

export type ParsedAmenity = { value: boolean; evidence: string };

export type ParsePubAmenityResult =
  | { ok: true; amenities: Partial<Record<PubWebsiteAmenityKey, ParsedAmenity>> }
  | { ok: false; reason: string };

const KEY_SET = new Set<string>(PUB_WEBSITE_AMENITY_KEYS);

function foldText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function asParsedAmenity(value: unknown): ParsedAmenity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.value !== "boolean") return null;
  if (typeof record.evidence !== "string") return null;
  return { value: record.value, evidence: record.evidence };
}

/** Read the model's JSON. Unknown keys and mistyped values are dropped. */
export function parsePubAmenityModelJson(raw: string): ParsePubAmenityResult {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "not-an-object" };
  }
  const record = data as Record<string, unknown>;
  const source =
    record.amenities && typeof record.amenities === "object" && !Array.isArray(record.amenities)
      ? (record.amenities as Record<string, unknown>)
      : record;
  const amenities: Partial<Record<PubWebsiteAmenityKey, ParsedAmenity>> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!KEY_SET.has(key)) continue;
    const parsed = asParsedAmenity(value);
    if (!parsed) continue;
    amenities[key as PubWebsiteAmenityKey] = parsed;
  }
  return { ok: true, amenities };
}

/**
 * A quote counts when the page contains it after whitespace and case folding.
 * A single short token is not a snippet, and a paragraph is not one either.
 */
export function evidenceQuoteIsOnPage(pageText: string, quote: string): boolean {
  const folded = foldText(quote);
  if (folded.length < MIN_EVIDENCE_CHARS || folded.length > MAX_EVIDENCE_CHARS) return false;
  return foldText(pageText).includes(folded);
}

/** Keep true values whose evidence is a quote from the page. Everything else goes. */
export function keepEvidencedAmenities(
  amenities: Partial<Record<PubWebsiteAmenityKey, ParsedAmenity>>,
  pageText: string,
): Partial<Record<PubWebsiteAmenityKey, string>> {
  const kept: Partial<Record<PubWebsiteAmenityKey, string>> = {};
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const item = amenities[key];
    if (!item?.value) continue;
    const evidence = item.evidence.trim();
    if (!evidenceQuoteIsOnPage(pageText, evidence)) continue;
    kept[key] = evidence;
  }
  return kept;
}

const BLANK_AMENITY = /^(?:|n\/a|na|n\.a\.?|not applicable|unknown|tbc|tbd|-|\?)$/i;

/** A column nobody has answered. A stated yes or no is left to the source that said it. */
export function amenityColumnIsBlank(value: unknown): boolean {
  return BLANK_AMENITY.test(String(value ?? "").trim().toLowerCase());
}

export function stampAmenityColumns<T extends Record<string, unknown>>(
  row: T,
  amenities: Partial<Record<PubWebsiteAmenityKey, string>>,
): { row: T; stamped: PubWebsiteAmenityKey[] } {
  const next = { ...row };
  const stamped: PubWebsiteAmenityKey[] = [];
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const evidence = amenities[key];
    if (typeof evidence !== "string" || !evidence.trim()) continue;
    const column = PUB_WEBSITE_AMENITY_COLUMNS[key];
    if (!amenityColumnIsBlank(next[column])) continue;
    next[column] = "yes";
    stamped.push(key);
  }
  return { row: next, stamped };
}

export function projectPubAmenitySpend(input: {
  calls: number;
  inputTokensPerCall: number;
  outputTokensPerCall: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}): number {
  const calls = Math.max(0, input.calls);
  const inputTokens = Math.max(0, input.inputTokensPerCall);
  const outputTokens = Math.max(0, input.outputTokensPerCall);
  return (
    (calls * inputTokens * input.inputUsdPerMillion) / 1_000_000 +
    (calls * outputTokens * input.outputUsdPerMillion) / 1_000_000
  );
}

export function spendFromTokenCounts(input: {
  inputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}): number {
  return projectPubAmenitySpend({
    calls: 1,
    inputTokensPerCall: input.inputTokens,
    outputTokensPerCall: input.outputTokens,
    inputUsdPerMillion: input.inputUsdPerMillion,
    outputUsdPerMillion: input.outputUsdPerMillion,
  });
}

export type PubSite = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  website: string;
};

export type VenueAnchor = {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
};

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const CHAIN_SUFFIX =
  /^(?:jd wetherspoon|j d wetherspoon|wetherspoon|greene king|nicholson s|nicholsons|young s|youngs)$/;

function namesMatch(pubName: string, venueName: string): boolean {
  const pub = normaliseName(pubName);
  const venue = normaliseName(venueName);
  if (!pub || !venue) return false;
  if (pub === venue) return true;
  const chainSuffix = (longer: string, shorter: string) => {
    if (shorter.split(" ").length < 2) return false;
    if (!longer.startsWith(`${shorter} `)) return false;
    return CHAIN_SUFFIX.test(longer.slice(shorter.length).trim());
  };
  // "The Shy Horse" matches "The Shy Horse - JD Wetherspoon".
  // "The Crown" does not match "The Crown and Treaty".
  return chainSuffix(venue, pub) || chainSuffix(pub, venue);
}

/** Closest venue whose name agrees, inside the metre cap. No match when two names only share a word. */
export function matchPubToVenue(
  pub: PubSite,
  venues: readonly VenueAnchor[],
  maxMetres = MATCH_METRES,
): VenueAnchor | null {
  let best: { venue: VenueAnchor; metres: number } | null = null;
  for (const venue of venues) {
    if (!namesMatch(pub.name, venue.name)) continue;
    const metres = haversineMeters(pub.lat, pub.lng, venue.lat, venue.lng);
    if (metres > maxMetres) continue;
    if (!best || metres < best.metres) best = { venue, metres };
  }
  return best?.venue ?? null;
}

export function venueGroupKey(row: {
  pub_name: string;
  address: string;
  latitude: number;
  longitude: number;
}): string {
  const part = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [
    part(row.pub_name),
    part(row.address),
    Number(row.latitude).toFixed(5),
    Number(row.longitude).toFixed(5),
  ].join("|");
}

/** Same FNV-1a id the slim index and lib/venues.ts publish. */
export function stableVenueId(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}
