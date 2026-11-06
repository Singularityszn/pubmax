// Amenity claims taken from a pub's own website.
//
// A true value is kept only when the model quotes a phrase that is actually on
// the page and that phrase states the amenity. The quote is the evidence. A
// blank price-dataset column is the existing amenity path, so a kept value
// stamps that column with SITE_STAMP and leaves a column the source already
// answered alone.

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

const MIN_EVIDENCE_CHARS = 8;
const MAX_EVIDENCE_CHARS = 280;
export const PAGE_CHAR_CAP = 12_000;
export const MAX_OUTPUT_TOKENS = 700;
export const JOB_SPEND_CAP_USD = 6;
const MATCH_METRES = 120;

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

const ALCOHOL_FREE =
  /alch?ohol[\s-]*free|\bnon\s*[-\u2013]?\s*alch?oholic\s+(?:options?|offerings?|beers?|wines?|champagne|prosecco|cocktails?|spirits?|spritz(?:es)?|gins?|lagers?|ales?)\b|\bno[\s-]+alch?ohol|\b(?:low|no)\s*(?:and|&|\/|or)\s*(?:low|no)[\s-]*(?:alch?ohol|abv|options?|drinks?|beers?|wines?|spritz|serves|bottles)\b|\bzero[\s-]*proof|\b0(?:\.[05])?\s*%|\b0\.0|\bmocktails?\b|\bvirgin\b/i;
const DARTS = /\bdarts?\b|dartboards?/i;
const DARTS_PLAYED =
  /dartboards?|\b(?:boards?|lanes?|oche|interactive|smart|digital|electric|ar|games?|play|teams?|club|league|competitions?|social|party|room|set of|round of|pool|shuffleboard|try your hand)\b/i;
const TELEVISED_SPORT =
  /\b(?:f1|formula\s*1|boxing|footy|rugby|football|cricket|sports?|sporting|action|grand prix|semi-?finals?|final|championship|watch|screens?|tv|televised|geschaut)\b/i;
const POOL = /\bpool\b/i;
const NOT_A_POOL_TABLE = /\b(?:charging|swimming|car\s*pool|pool\s*(?:side|party|parties|house))\b/i;
const KARAOKE = /\bkar(?:aoke|oake)\b/i;
const SPORT_SHOWN =
  /\bsports?\b|\bsporting\b|\bmatch(?:es)?\b|\bmatch[\s-]?day\b|\bgame[\s-]?days?\b|\bgames?\b|\bfixtures?\b|\bfootball\b|\bfooty\b|\brugby\b|\bcricket\b|\bboxing\b|\bpremier league\b|\bchampions league\b|\bnations\b|\bworld cup\b|\binternationals\b|\bgaa\b|\bgaelic\b|\bwimbledon\b/i;
const SPORT_VIEWING =
  /\b(?:show(?:s|ing|n|cas(?:e|es|ing))?|watch(?:es|ing)?|screen(?:s|ed|ings?)?|tvs?|televised|broadcast(?:s|ing)?|catch(?:es|ing)?|playing|viewings?|projectors?)\b|\blive\s+(?:sports?|sporting|football|footy|rugby|cricket|gaelic|gaa|premier league|boxing)\b|\b(?:sky|tnt|bt)\s+sports?\b|\bsports?\s+(?:pub|bar)s?\b/i;
/** Team fixture copy must explicitly invite live viewing; a bare "vs" is not sport. */
const LIVE_TEAM_FIXTURE = /\bwatch\s+[a-z][a-z0-9 &'-]{0,60}\s+vs\s+[a-z][a-z0-9 &'-]{0,60}\s+live\b/i;
const NO_SPORT_VIEWING = new RegExp(
  `\\b(?:no|without)\\s+(?:live\\s+|sky\\s+|tnt\\s+|bt\\s+)?(?:${SPORT_SHOWN.source}|\\b(?:screens?|screenings?|tvs?)\\b)|` +
  `\\b(?:do\\s+not|don'?t|never)\\s+show\\s+(?:any\\s+)?(?:live\\s+)?(?:${SPORT_SHOWN.source})|` +
  "\\b(?:not|aren'?t|isn'?t)\\s+(?:a\\s+)?sports?\\s+(?:pub|bar)s?\\b",
  "i",
);
const NOT_SPORT_SHOWN = /\bbet(?:s|ting)?\b|sportsbook|taruhan|cá cược|\be-?sports\b/i;
const LIVE_MUSIC =
  /\blive\b[^.]{0,20}\b(?:music|bands?|gigs?|jazz|folk|blues|soul|funk|country|singers?|vocals|acts?|artists)\b|\bbands?\b|\bgigs?\b|\bjazz\b|\bfolk\b|\bblues\b|\bopen mic\b|\bsingers?\b|\bsings? live\b|\bchoir\b|\bjams?\b|\bacoustic\b|\btrad\b|\bseisi|\bconcerts?\b|\btribute show\b|\bmusic venues?\b|\bmusic (?:nights?|events?)\b/i;
/** Drinks before or after an event somewhere else say nothing about what happens inside the pub. */
const EVENT_ELSEWHERE = /\b(?:pre|post)\b[^.]{0,12}\b(?:match|concert|gig|show)\b|\b(?:match|concert|gig)\b.*\bdrinks\b/i;
const QUIZ = /quiz|\btrivia\b/i;
const QUIZ_MACHINE = /\bquiz machines?\b/i;
const HAPPY_HOUR =
  /\bh[ao]ppy\s*hours?\b|\bhappiest hours?\b|\bbogof?\b|\b(?:2|two)\s*-?\s*(?:for|4)\s*-?\s*(?:1|one|\u00a3)|\bhalf[\s-]*price|\d\s*%\s*off\b|\u00a3\s*\d/i;
const CHAIN_NEWS = /\bfuelling growth\b|\bsales\b|\bgreene king pubs\b/i;
/** Chain headlines a pub page links to. A shortened copy of one is still the headline. */
const CHAIN_HEADLINES = ["alcohol free cocktails fuelling growth in low and no sales at greene king pubs"];
/** Events a pub's page advertises at another venue. */
const ANOTHER_VENUE_EVENTS = new Set(["the lexington pop quiz"]);
const SEASONAL_PROMO = /\b(?:christmas|festive|halloween|new years?(?: eve)?)\b/i;
const SITE_NAVIGATION = /\b(?:about us|contact us|careers|hotels)\b|\s[-\u2013]\s*j\s*d\s*wetherspoon\b/i;
/** A quote that opens on the last word of a sentence has lost the sentence that word belonged to. */
const SENTENCE_TAIL = /^[\w'-]+\.(?:\s|$)/;
/** A question asks; it does not state. */
const QUESTION = /\?$/;
/** A quote cut off after a verb that still needs its object. */
const DANGLING_INFINITIVE = /\bto (?:keep|make|get|give|take|bring|have)$/;

/**
 * What a quote must say for each amenity to stand. Tea, coffee, soft drinks and
 * a kids' meal drink are not alcohol-free beer. Darts on the television is not
 * a dartboard, and a screen is not sport until something is shown on it. A
 * fixture or tournament name is not sport either until the quote says the pub
 * shows it, or the pub calls itself a sports pub. A time range alone is not a
 * happy hour. A key without an entry needs only the
 * quote.
 */
const AMENITY_STATEMENTS: Partial<Record<PubWebsiteAmenityKey, (quote: string) => boolean>> = {
  food: (quote) => !SITE_NAVIGATION.test(quote),
  liveSports: (quote) =>
    !NOT_SPORT_SHOWN.test(quote) && !EVENT_ELSEWHERE.test(quote) &&
    quote.split(/[.,;!?]|\b(?:but|however|yet|although|while)\b/i).some((clause) =>
      (SPORT_SHOWN.test(clause) || LIVE_TEAM_FIXTURE.test(clause)) &&
      SPORT_VIEWING.test(clause) && !NO_SPORT_VIEWING.test(clause),
    ),
  liveMusic: (quote) => LIVE_MUSIC.test(quote) && !EVENT_ELSEWHERE.test(quote),
  pubQuiz: (quote) => QUIZ.test(quote) && !QUIZ_MACHINE.test(quote),
  nonAlcoholic: (quote) => ALCOHOL_FREE.test(quote),
  darts: (quote) => DARTS.test(quote) && DARTS_PLAYED.test(quote) && !TELEVISED_SPORT.test(quote),
  pool: (quote) => POOL.test(quote) && !NOT_A_POOL_TABLE.test(quote),
  karaoke: (quote) => KARAOKE.test(quote) && !SENTENCE_TAIL.test(quote),
  happyHour: (quote) => HAPPY_HOUR.test(quote),
};

/** Chain-wide news and seasonal promotions describe the brand or the calendar, not this pub. */
function quoteIsChainOrSeasonal(quote: string): boolean {
  if (CHAIN_NEWS.test(quote) || SEASONAL_PROMO.test(quote)) return true;
  return quote.includes(" ") && CHAIN_HEADLINES.some((headline) => headline.includes(quote));
}

/** Whether a quote states the amenity at this pub, rather than only mentioning a nearby word. */
function evidenceStatesAmenity(key: PubWebsiteAmenityKey, quote: string): boolean {
  const folded = foldText(quote);
  if (
    quoteIsChainOrSeasonal(folded) ||
    ANOTHER_VENUE_EVENTS.has(folded) ||
    QUESTION.test(folded) ||
    DANGLING_INFINITIVE.test(folded)
  ) {
    return false;
  }
  const statement = AMENITY_STATEMENTS[key];
  return statement ? statement(folded) : true;
}

/** Stored quotes that state their amenity. Restamping goes through here, so an older quote cannot outlive the gate. */
export function statedAmenities(
  amenities: Partial<Record<PubWebsiteAmenityKey, string>>,
): Partial<Record<PubWebsiteAmenityKey, string>> {
  const stated: Partial<Record<PubWebsiteAmenityKey, string>> = {};
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const quote = amenities[key];
    if (typeof quote !== "string" || !evidenceStatesAmenity(key, quote)) continue;
    stated[key] = quote;
  }
  return stated;
}

export type PubEvidenceRow = {
  sourceUrl?: string;
  amenities?: Partial<Record<PubWebsiteAmenityKey, string>>;
};

function sourcePage(url: string): { host: string; page: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.host.toLowerCase();
    return { host, page: `${host}${parsed.pathname.replace(/\/+$/, "")}` };
  } catch {
    return null;
  }
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return counts;
}

/**
 * Evidence that speaks for one pub. A chain-wide page describes the brand
 * rather than any one pub, so it goes: a page more than one pub points at once
 * its query, fragment and trailing slash are set aside, the home page of a host
 * several pubs share, and a quote repeated word for word across pubs on one
 * host. Every stamp, from a fresh harvest or from the committed evidence file,
 * goes through here.
 */
export function pubSpecificEvidence<T extends PubEvidenceRow>(
  rows: readonly T[],
): (T & { amenities: Partial<Record<PubWebsiteAmenityKey, string>> })[] {
  const sourced = rows.flatMap((row) => {
    const source = row.sourceUrl ? sourcePage(row.sourceUrl) : null;
    return source ? [{ row, ...source }] : [];
  });
  const pubsPerPage = countBy(sourced, (item) => item.page);
  const pubsPerHost = countBy(sourced, (item) => item.host);
  const quoteKey = (host: string, key: string, quote: string) => `${host}\u0000${key}\u0000${foldText(quote)}`;
  const pubsPerQuote = countBy(
    sourced.flatMap(({ row, host }) =>
      Object.entries(row.amenities ?? {}).map(([key, quote]) => quoteKey(host, key, String(quote))),
    ),
    (item) => item,
  );
  const kept: (T & { amenities: Partial<Record<PubWebsiteAmenityKey, string>> })[] = [];
  for (const { row, host, page } of sourced) {
    if (pubsPerPage.get(page) !== 1) continue;
    if (page === host && (pubsPerHost.get(host) ?? 0) > 1) continue;
    const ownQuotes: Partial<Record<PubWebsiteAmenityKey, string>> = {};
    for (const [key, quote] of Object.entries(row.amenities ?? {}) as [PubWebsiteAmenityKey, string][]) {
      if (pubsPerQuote.get(quoteKey(host, key, quote)) === 1) ownQuotes[key] = quote;
    }
    const amenities = statedAmenities(ownQuotes);
    if (Object.keys(amenities).length === 0) continue;
    kept.push({ ...row, amenities });
  }
  return kept;
}

/** Keep true values whose evidence is a quote from the page that states the amenity. Everything else goes. */
export function keepEvidencedAmenities(
  amenities: Partial<Record<PubWebsiteAmenityKey, ParsedAmenity>>,
  pageText: string,
): Partial<Record<PubWebsiteAmenityKey, string>> {
  const onPage: Partial<Record<PubWebsiteAmenityKey, string>> = {};
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const item = amenities[key];
    if (!item?.value) continue;
    const evidence = item.evidence.trim();
    if (!evidenceQuoteIsOnPage(pageText, evidence)) continue;
    onPage[key] = evidence;
  }
  return statedAmenities(onPage);
}

const BLANK_AMENITY = /^(?:|n\/a|na|n\.a\.?|not applicable|unknown|tbc|tbd|-|\?)$/i;

/** A column nobody has answered. A stated yes or no is left to the source that said it. */
export function amenityColumnIsBlank(value: unknown): boolean {
  return BLANK_AMENITY.test(String(value ?? "").trim().toLowerCase());
}

/**
 * What a stamp writes. No source column uses it, so the next stamp can lift
 * every earlier one and start again from what the source said.
 */
export const SITE_STAMP = "y";

export function stampAmenityColumns<T extends Record<string, unknown>>(
  row: T,
  amenities: Partial<Record<PubWebsiteAmenityKey, string>>,
): { row: T; stamped: PubWebsiteAmenityKey[] } {
  const next: Record<string, unknown> = { ...row };
  const stamped: PubWebsiteAmenityKey[] = [];
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const evidence = amenities[key];
    if (typeof evidence !== "string" || !evidence.trim()) continue;
    const column = PUB_WEBSITE_AMENITY_COLUMNS[key];
    if (!amenityColumnIsBlank(next[column])) continue;
    next[column] = SITE_STAMP;
    stamped.push(key);
  }
  return { row: next as T, stamped };
}

/** `non_alcoholic` exists only as a stamp; the other columns come from the source. */
const STAMP_ONLY_COLUMNS = new Set<string>([PUB_WEBSITE_AMENITY_COLUMNS.nonAlcoholic]);

/** The row as the source left it, before any stamp from a pub's site. */
export function liftSiteStamps<T extends Record<string, unknown>>(row: T): T {
  let next: Record<string, unknown> | null = null;
  for (const key of PUB_WEBSITE_AMENITY_KEYS) {
    const column = PUB_WEBSITE_AMENITY_COLUMNS[key];
    if (row[column] !== SITE_STAMP) continue;
    next ??= { ...row };
    if (STAMP_ONLY_COLUMNS.has(column)) delete next[column];
    else next[column] = "";
  }
  return (next ?? row) as T;
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
