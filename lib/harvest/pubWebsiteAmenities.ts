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
  osmId: string;
  sourceUrl?: string;
  amenities?: Partial<Record<PubWebsiteAmenityKey, string>>;
};

function sourcePage(url: string): { host: string; page: string } | null {
  try {
    const parsed = new URL(url);
    // www.chain.example and chain.example are one site.
    const host = parsed.host.toLowerCase().replace(/^www\./, "");
    return { host, page: `${host}${parsed.pathname.replace(/\/+$/, "")}` };
  } catch {
    return null;
  }
}

/** A page as the chain rule sees it: host without www and path, with no query, fragment or trailing slash. */
function chainPageKey(url: string): string | null {
  return sourcePage(url)?.page ?? null;
}

/** A page or host written by hand, with or without its scheme, read the way the chain rule reads a URL. */
function writtenSource(written: unknown): { host: string; page: string } | null {
  return typeof written === "string" && written ? sourcePage(`https://${written.replace(/^https?:\/\//i, "")}`) : null;
}

/** A quote one host repeats word for word for several pubs, stored folded. */
type ChainQuote = { host: string; key: PubWebsiteAmenityKey; quote: string };

/** A quote on one host and the pubs that have stated it. */
type QuoteReaders = ChainQuote & { readers: string[] };

/**
 * Pages and quotes proven chain-wide, the pubs that have read each page and
 * the pubs that have stated each quote. A harvest keeps only the pubs that
 * pass the chain rule, and a pub that kept no amenity or failed never reaches
 * the evidence file, so those pubs are gone from the next run's count. The
 * committed list remembers every reader.
 */
export type ChainDenylist = {
  pages: string[];
  quotes: ChainQuote[];
  readers: Record<string, string[]>;
  quoteReaders: QuoteReaders[];
};

export const EMPTY_CHAIN_DENYLIST: ChainDenylist = { pages: [], quotes: [], readers: {}, quoteReaders: [] };

const quoteId = (host: string, key: string, quote: string) => `${host}\u0000${key}\u0000${foldText(quote)}`;

const isOsmIdList = (osmIds: unknown): osmIds is string[] =>
  Array.isArray(osmIds) && osmIds.every((osmId) => typeof osmId === "string" && osmId);

function parseChainQuote(item: unknown): ChainQuote {
  const entry = (item ?? {}) as Record<string, unknown>;
  const source = writtenSource(entry.host);
  if (!source || source.page !== source.host || typeof entry.quote !== "string" || !KEY_SET.has(String(entry.key))) {
    throw new Error("chain denylist quote needs host, amenity key and quote");
  }
  return { host: source.host, key: entry.key as PubWebsiteAmenityKey, quote: foldText(entry.quote) };
}

/** Read a committed denylist. A malformed file throws, because a silent empty list lets chain pages back in. */
export function parseChainDenylist(data: unknown): ChainDenylist {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("chain denylist is not an object");
  const record = data as Record<string, unknown>;
  if (!Array.isArray(record.pages) || !Array.isArray(record.quotes) || !Array.isArray(record.quoteReaders)) {
    throw new Error("chain denylist needs pages, quotes and quoteReaders arrays");
  }
  if (!record.readers || typeof record.readers !== "object" || Array.isArray(record.readers)) {
    throw new Error("chain denylist needs a readers object");
  }
  const pages = record.pages.map((page) => {
    const key = writtenSource(page)?.page;
    if (!key) throw new Error("chain denylist page is not a page");
    return key;
  });
  const quotes = record.quotes.map(parseChainQuote);
  const readers: Record<string, string[]> = {};
  for (const [page, osmIds] of Object.entries(record.readers as Record<string, unknown>)) {
    const key = writtenSource(page)?.page;
    if (!key || !isOsmIdList(osmIds)) throw new Error("chain denylist readers need a page and the osm ids that read it");
    readers[key] = [...(readers[key] ?? []), ...osmIds];
  }
  const quoteReaders = record.quoteReaders.map((item) => {
    const osmIds = (item as Record<string, unknown> | null)?.readers;
    if (!isOsmIdList(osmIds)) throw new Error("chain denylist quote readers need the osm ids that stated the quote");
    return { ...parseChainQuote(item), readers: osmIds };
  });
  return mergeChainDenylists(EMPTY_CHAIN_DENYLIST, { pages, quotes, readers, quoteReaders });
}

/**
 * The pages the readers prove chain-wide: a page more than one pub has read,
 * and the home page of a host whose pages more than one pub has read.
 */
function pagesProvenByReaders(readers: Record<string, string[]>): string[] {
  const hostOf = (page: string) => page.split("/")[0] ?? "";
  const pubsPerHost = new Map<string, Set<string>>();
  for (const [page, osmIds] of Object.entries(readers)) {
    const pubs = pubsPerHost.get(hostOf(page)) ?? new Set<string>();
    for (const osmId of osmIds) pubs.add(osmId);
    pubsPerHost.set(hostOf(page), pubs);
  }
  return Object.entries(readers)
    .filter(([page, osmIds]) => osmIds.length > 1 || (page === hostOf(page) && (pubsPerHost.get(page)?.size ?? 0) > 1))
    .map(([page]) => page);
}

/** Both lists in one, deduplicated and sorted, so the committed file only changes when the proof does. */
export function mergeChainDenylists(a: ChainDenylist, b: ChainDenylist): ChainDenylist {
  const readers: Record<string, string[]> = {};
  for (const page of [...new Set([...Object.keys(a.readers), ...Object.keys(b.readers)])].sort()) {
    readers[page] = [...new Set([...(a.readers[page] ?? []), ...(b.readers[page] ?? [])])].sort();
  }
  const pages = [...new Set([...a.pages, ...b.pages, ...pagesProvenByReaders(readers)])].sort();
  const quoteReaders = new Map<string, QuoteReaders>();
  for (const entry of [...a.quoteReaders, ...b.quoteReaders]) {
    const id = quoteId(entry.host, entry.key, entry.quote);
    const seen = quoteReaders.get(id)?.readers ?? [];
    quoteReaders.set(id, { ...entry, quote: foldText(entry.quote), readers: [...new Set([...seen, ...entry.readers])].sort() });
  }
  const quotes = new Map<string, ChainQuote>();
  const provenByReaders = [...quoteReaders.values()].filter((entry) => entry.readers.length > 1);
  for (const { host, key, quote } of [...a.quotes, ...b.quotes, ...provenByReaders]) {
    quotes.set(quoteId(host, key, quote), { host, key, quote: foldText(quote) });
  }
  const byId = <T>(entries: Map<string, T>) =>
    [...entries.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, entry]) => entry);
  return { pages, quotes: byId(quotes), readers, quoteReaders: byId(quoteReaders) };
}

/** Whether a URL is a page already proven chain-wide. The harvest asks this before it fetches. */
export function isChainPage(url: string, denylist: ChainDenylist): boolean {
  const page = chainPageKey(url);
  return page !== null && denylist.pages.includes(page);
}

function sourcedRows<T extends PubEvidenceRow>(rows: readonly T[]) {
  return rows.flatMap((row) => {
    const source = row.sourceUrl ? sourcePage(row.sourceUrl) : null;
    return source ? [{ row, ...source }] : [];
  });
}

/**
 * What these rows prove chain-wide. Each row is a pub that read its source
 * page, with the quotes it stated if any. A page is proven once more than one
 * pub has read it with its query, fragment and trailing slash set aside, the
 * home page of a host once several pubs have read that host, and a quote once
 * more than one pub on one host has stated it word for word.
 */
export function provenChainEvidence<T extends PubEvidenceRow>(rows: readonly T[]): ChainDenylist {
  const sourced = sourcedRows(rows);
  const readers: Record<string, string[]> = {};
  for (const { row, page } of sourced) readers[page] = [...(readers[page] ?? []), row.osmId];
  const quoteReaders = sourced.flatMap(({ row, host }) =>
    (Object.entries(row.amenities ?? {}) as [PubWebsiteAmenityKey, string][]).map(([key, quote]) => ({
      host,
      key,
      quote: String(quote),
      readers: [row.osmId],
    })),
  );
  return mergeChainDenylists(EMPTY_CHAIN_DENYLIST, { pages: [], quotes: [], readers, quoteReaders });
}

/**
 * Evidence that speaks for one pub. A chain-wide page or quote describes the
 * brand rather than any one pub, so it goes, whether these rows prove it or
 * the committed denylist already holds the proof from an earlier run. Every
 * stamp, from a fresh harvest or from the committed evidence file, goes
 * through here.
 */
export function pubSpecificEvidence<T extends PubEvidenceRow>(
  rows: readonly T[],
  denylist: ChainDenylist = EMPTY_CHAIN_DENYLIST,
): (T & { amenities: Partial<Record<PubWebsiteAmenityKey, string>> })[] {
  const chain = mergeChainDenylists(denylist, provenChainEvidence(rows));
  const chainPages = new Set(chain.pages);
  const chainQuotes = new Set(chain.quotes.map((entry) => quoteId(entry.host, entry.key, entry.quote)));
  const kept: (T & { amenities: Partial<Record<PubWebsiteAmenityKey, string>> })[] = [];
  for (const { row, host, page } of sourcedRows(rows)) {
    if (chainPages.has(page)) continue;
    const ownQuotes: Partial<Record<PubWebsiteAmenityKey, string>> = {};
    for (const [key, quote] of Object.entries(row.amenities ?? {}) as [PubWebsiteAmenityKey, string][]) {
      if (!chainQuotes.has(quoteId(host, key, String(quote)))) ownQuotes[key] = quote;
    }
    const amenities = statedAmenities(ownQuotes);
    if (Object.keys(amenities).length === 0) continue;
    kept.push({ ...row, amenities });
  }
  return kept;
}

/** One pub's harvest outcome, as the checkpoint keeps it. */
export type HarvestRead = {
  status?: string;
  name?: string;
  venueId?: string | null;
  sourceUrl?: string;
  verifiedAt?: string;
  amenities?: Partial<Record<PubWebsiteAmenityKey, string>>;
};

export type HarvestEvidenceRow = PubEvidenceRow & {
  osmId: string;
  name?: string;
  venueId?: string | null;
  verifiedAt?: string;
};

/**
 * The committed evidence with this run's pages laid over it, and the chain
 * list with every reader and what they prove. `fresh` is what this process
 * read. `checkpoint` is every read the checkpoint holds, this process's and
 * those of a run that stopped before it wrote the chain list, so a resumed
 * harvest still counts the pubs it will not read again. Every pub that read a
 * page is a reader, whatever came of the read, and its quotes count before
 * the chain rule drops any of them.
 */
export function mergeHarvestEvidence(input: {
  previousRows: readonly HarvestEvidenceRow[];
  previousSkipCounts?: Record<string, number>;
  fresh: ReadonlyMap<string, HarvestRead>;
  checkpoint: Readonly<Record<string, HarvestRead>>;
  knownChainPages: ChainDenylist;
}): { rows: HarvestEvidenceRow[]; skipCounts: Record<string, number>; chainPages: ChainDenylist } {
  const skipCounts = { ...(input.previousSkipCounts ?? {}) };
  const candidates: HarvestEvidenceRow[] = input.previousRows.filter((row) => !input.fresh.has(row.osmId));
  for (const [osmId, entry] of input.fresh) {
    if (entry.status !== "ok") {
      const status = entry.status ?? "unknown";
      skipCounts[status] = (skipCounts[status] ?? 0) + 1;
      continue;
    }
    candidates.push({
      osmId,
      name: entry.name,
      venueId: entry.venueId,
      sourceUrl: entry.sourceUrl,
      verifiedAt: entry.verifiedAt,
      amenities: entry.amenities ?? {},
    });
  }
  const reads = [...new Map([...Object.entries(input.checkpoint), ...input.fresh]).entries()].flatMap(
    ([osmId, entry]) => (entry.sourceUrl ? [{ osmId, sourceUrl: entry.sourceUrl, amenities: entry.amenities ?? {} }] : []),
  );
  const chainPages = mergeChainDenylists(input.knownChainPages, provenChainEvidence([...candidates, ...reads]));
  const rows = pubSpecificEvidence(candidates, chainPages).sort((a, b) => a.osmId.localeCompare(b.osmId));
  const unused = candidates.length - rows.length;
  if (unused > 0) skipCounts.ok = (skipCounts.ok ?? 0) + unused;
  return { rows, skipCounts, chainPages };
}

export type PageRead = { ok: true; url: string; text: string } | { ok: false; reason: string };

/**
 * The text of one extra page from a pub's site, or null. A link is checked
 * against the source policy and the chain list before it is fetched, and the
 * page it lands on is checked against the chain list again, because a pub's
 * own `/menu` can redirect to a chain-wide page.
 */
export async function readExtraPage(
  link: string,
  deps: {
    chainPages: ChainDenylist;
    isHarvestable: (url: string) => boolean;
    robots: (url: string) => Promise<{ allowed: boolean }>;
    readHtml: (url: string) => Promise<PageRead>;
  },
): Promise<string | null> {
  if (!deps.isHarvestable(link) || isChainPage(link, deps.chainPages)) return null;
  if (!(await deps.robots(link)).allowed) return null;
  const extra = await deps.readHtml(link);
  if (!extra.ok || isChainPage(extra.url, deps.chainPages)) return null;
  return extra.text;
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

/** A page shorter than this after tags are stripped is read as a script-built page. */
const THIN_PAGE_CHARS = 200;

/**
 * Whether a plain read may be asked again through Firecrawl. Only a read the
 * network or a script-built page kept from us qualifies: a timeout, a failed
 * connection, a 429 or 5xx, or a page with almost no text. A 401, 403 or 451 is
 * the site refusing us, a 404 or 410 is gone, and a redirect off the source
 * fence stays refused, so none of those is read another way.
 */
export function firecrawlMayReread(read: PageRead): boolean {
  if (read.ok) return read.text.length < THIN_PAGE_CHARS;
  if (read.reason === "timeout" || read.reason === "fetch-failed") return true;
  const status = Number(/^http-(\d{3})$/.exec(read.reason)?.[1]);
  return status === 429 || status >= 500;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** The full UK postcode an address states, normalised as "N1 9AA", or null. */
export function postcodeOf(address: string): string | null {
  const match = POSTCODE.exec(address);
  return match ? `${match[1]} ${match[2]}`.toUpperCase() : null;
}

/** Whether page text states this postcode, with or without its space. */
export function pageStatesPostcode(text: string, postcode: string): boolean {
  const [outward, inward] = postcode.toUpperCase().split(" ");
  return new RegExp(`\\b${outward}\\s*${inward}\\b`, "i").test(text);
}

/**
 * The first search hit that can be this pub's own site: permitted by the
 * source policy, not a chain-wide page, and on a host that carries a
 * distinctive word of the pub's name. The page must still state the pub's
 * postcode before anything read from it counts.
 */
export function locatedOwnSite(
  name: string,
  hits: readonly { url: string }[],
  deps: {
    chainPages: ChainDenylist;
    isHarvestable: (url: string) => boolean;
    ownSite: (name: string, url: string) => string | null;
  },
): string | null {
  for (const { url } of hits) {
    if (!deps.isHarvestable(url) || isChainPage(url, deps.chainPages)) continue;
    if (deps.ownSite(name, url)) return url;
  }
  return null;
}

const STREET_SUFFIXES: Record<string, string> = {
  st: "street", rd: "road", ln: "lane", ave: "avenue", sq: "square", pl: "place", ct: "court", cres: "crescent", gdns: "gardens", hwy: "highway",
};

/**
 * The street an address names in its first part, without the house number,
 * as words, or null when that part has fewer than two words. "10 James St,
 * London" gives ["james", "street"].
 */
export function streetOf(address: string): string[] | null {
  const first = address.split(",")[0]?.toLowerCase().replace(/^[\d\s\-–/a-z]{0,4}\d[a-z]?\b/, "") ?? "";
  const words = first.match(/[a-z']+/g)?.map((word) => STREET_SUFFIXES[word] ?? word) ?? [];
  return words.length >= 2 ? words : null;
}

/** Whether page text names this street, its suffix spelled out or abbreviated. */
export function pageStatesStreet(text: string, street: readonly string[]): boolean {
  const abbreviations = Object.fromEntries(Object.entries(STREET_SUFFIXES).map(([short, long]) => [long, short]));
  const pattern = street
    .map((word) => (abbreviations[word] ? `(?:${word}|${abbreviations[word]}\\.?)` : word.replace(/'/g, "['’]?")))
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(text);
}

/**
 * Whether this page belongs to another pub. The price dataset can hold one pub
 * twice under two spellings, and a read by the duplicate would prove the page,
 * or a quote on it, chain-wide and withdraw the first pub's evidence. A page
 * another pub has read is that pub's, and so is any page on a host exactly one
 * other pub has read. A host two or more pubs read is a chain's, whose other
 * pages the chain list already judges.
 */
export function siteOfAnotherPub(
  url: string,
  osmId: string,
  reads: readonly { osmId: string; sourceUrl?: string }[],
): boolean {
  const target = sourcePage(url);
  if (!target) return false;
  const others = reads.flatMap((read) => {
    const source = read.osmId !== osmId && read.sourceUrl !== undefined ? sourcePage(read.sourceUrl) : null;
    return source ? [{ osmId: read.osmId, ...source }] : [];
  });
  if (others.some((read) => read.page === target.page)) return true;
  return new Set(others.filter((read) => read.host === target.host).map((read) => read.osmId)).size === 1;
}

/**
 * This run's reads without those that would make a pub's evidence thinner. A
 * scoped harvest reads again pubs whose site already gave evidence, and a
 * re-read that failed or kept fewer amenities leaves the earlier row in place.
 */
export function withoutThinnerRereads(
  fresh: ReadonlyMap<string, HarvestRead>,
  previousRows: readonly HarvestEvidenceRow[],
): Map<string, HarvestRead> {
  const previous = new Map(previousRows.map((row) => [row.osmId, Object.keys(row.amenities ?? {}).length]));
  return new Map(
    [...fresh].filter(([osmId, entry]) => {
      const before = previous.get(osmId);
      if (before === undefined) return true;
      return entry.status === "ok" && Object.keys(entry.amenities ?? {}).length > before;
    }),
  );
}
