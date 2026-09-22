// Deterministic extraction of drink-price candidates from Reddit comment bodies.

import { drinkCategoryFromText } from "@/lib/drinkCategoryFromText";
import {
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  roundToPennies,
} from "@/lib/communityPrice";

import { measureNamedInDrinkText, type DrinkMeasure } from "@/lib/drinkMeasure";

export type RedditPriceCandidate = {
  priceGbp: number;
  priceText: string;
  drinkText: string;
  measure?: DrinkMeasure;
  measureLabel?: string;
  drinkCategory: NonNullable<ReturnType<typeof drinkCategoryFromText>>;
  snippet: string;
  permalink: string;
  observedAt: string;
  author: string;
  pubNameHint: string | null;
  areaHint: string | null;
};

const POUND_RE = /£\s*(\d{1,2}(?:\.\d{1,2})?)(?!\d|[.,]\d)/g;
const JOKE_OR_HYPOTHETICAL =
  /\b(wish|would be|should be|used to be|remember when|in my day|if only|imagine|probably|maybe|about|around|ish)\b/i;
const RETROSPECTIVE = /\b(remember when|used to (?:be|cost|pay)|in my day|(?:back in|in|during|since) (?:19|20)\d{2}|years? ago)\b/i;

export function isRetrospectiveRedditPrice(text: string): boolean {
  return RETROSPECTIVE.test(text);
}

export function isHypotheticalRedditPrice(text: string): boolean {
  return /\b(wish|would|should|if only|imagine|probably|maybe)\b[^£]*£/i.test(text);
}
const PAID_OR_SAW =
  /\b(paid|pay|cost|costs|charged|was|is|it's|its|got|had|buy|bought|on the menu|they'?re charging|price is|prices are)\b/i;
const PUB_NAME_RE =
  /\b(?:at|in|from)\s+(?:the\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,5})\b/;
const LONDON_AREA_RE =
  /\b(Camden|Shoreditch|Brixton|Clapham|Islington|Hackney|Greenwich|Wimbledon|Croydon|Peckham|Dalston|Hoxton|Fulham|Putney|Walthamstow|Stratford|Soho|Mayfair|Westminster|Bethnal Green|King'?s Cross|Angel|Highbury|Tooting|Balham|Richmond|Hammersmith|Barnet|Enfield|Bexley|Bromley|Lambeth|Southwark|Tower Hamlets|Haringey|Lewisham|Merton|Newham|Redbridge|Wandsworth|City of London)\b/i;

export function redditObservedAt(createdUtc: number | string): string {
  const ms = typeof createdUtc === "number" ? createdUtc * 1000 : Date.parse(createdUtc);
  return Number.isFinite(ms) && ms > 0 && ms <= Date.now() ? new Date(ms).toISOString() : "";
}

function extractPubNameHint(body: string): string | null {
  const m = body.match(PUB_NAME_RE);
  if (!m) return null;
  let name = m[1].trim();
  name = name.replace(/\s+\bin\b.+$/i, "").trim();
  name = name.replace(/\s+\bat\b.+$/i, "").trim();
  return name.length >= 3 ? name : null;
}

function extractAreaHint(body: string): string | null {
  const pub = body.match(PUB_NAME_RE);
  if (!pub || pub.index === undefined) return null;
  const afterPub = body.slice(pub.index + pub[0].length);
  const location = afterPub.match(/^\s+in\s+(.+)$/i);
  if (!location) return null;
  const area = location[1].match(LONDON_AREA_RE);
  return area?.index === 0 ? area[1] : null;
}

function priceLocalDrink(clause: string, priceIndex: number, priceLength: number): string | null {
  if (/\b(food|burger|chips|fries|meal|pizza|sandwich|breakfast|lunch|dinner|total|round of)\b/i.test(clause)) return null;
  const after = clause.slice(priceIndex + priceLength)
    .replace(/^\s*(?:for\s+)?(?:an?\s+)?/i, "")
    .split(/\s+\b(?:at|in|from|last|yesterday|today)\b/i)[0].trim();
  const before = clause.slice(0, priceIndex)
    .split(/\s+\b(?:at|in|from|was|is|costs?|paid|charged)\b/i)[0]
    .replace(/^(?:I|we)\s+(?:had|got|bought)\s+/i, "")
    .replace(/^an?\s+/i, "").trim();
  for (const description of [after, before]) {
    if (description.length > 80 || !drinkCategoryFromText(description)) continue;
    return description;
  }
  return null;
}

function statedMeasure(drink: string): { measure?: DrinkMeasure; measureLabel?: string } {
  const nonPint = measureNamedInDrinkText(drink);
  if (nonPint) return { measure: nonPint, ...(nonPint === "other" ? { measureLabel: drink.slice(0, 24) } : {}) };
  const volume = drink.match(/\b\d{2,4}\s*ml\b/i)?.[0];
  if (volume) return { measure: "other", measureLabel: volume };
  return /\bpint\b/i.test(drink) ? { measure: "pint" } : {};
}

export function extractRedditPriceCandidates(input: {
  body: string;
  permalink: string;
  observedAt: string;
  author: string;
}): RedditPriceCandidate[] {
  if (!redditObservedAt(input.observedAt)) return [];
  const body = String(input.body ?? "").replace(/\s+/g, " ").trim();
  if (body.length < 8) return [];
  if (isRetrospectiveRedditPrice(body)) return [];
  if (!PAID_OR_SAW.test(body) && !/\bpint\b/i.test(body)) return [];

  const namedPubs = [...body.matchAll(new RegExp(PUB_NAME_RE.source, "g"))];
  const unambiguousPub = namedPubs.length === 1 ? extractPubNameHint(body) : null;
  const unambiguousArea = namedPubs.length === 1 ? extractAreaHint(body) : null;
  const out: RedditPriceCandidate[] = [];
  const clauses = body.split(/[;!?]|,(?!\d)|\.(?=\s|$)|\s+(?:and|but|while|then)\s+(?=(?:a|an|the|I|we)\b[^£]*£)/i);
  for (const snippet of clauses.map((clause) => clause.trim()).filter(Boolean)) {
    const prices = [...snippet.matchAll(POUND_RE)];
    // A mixed-price clause has no reliable product-to-price association.
    if (prices.length !== 1) continue;
    const match = prices[0];
    const priceGbp = roundToPennies(Number(match[1]));
    if (priceGbp < COMMUNITY_PRICE_MIN_GBP || priceGbp > COMMUNITY_PRICE_MAX_GBP) continue;
    if (isHypotheticalRedditPrice(snippet)) continue;
    if (JOKE_OR_HYPOTHETICAL.test(snippet) && !PAID_OR_SAW.test(snippet)) continue;
    const drinkText = priceLocalDrink(snippet, match.index, match[0].length);
    if (!drinkText) continue;
    const drinkCategory = drinkCategoryFromText(drinkText);
    if (!drinkCategory) continue;
    const localPub = extractPubNameHint(snippet);
    out.push({
      priceGbp,
      priceText: match[0].replace(/\s+/g, ""),
      drinkText,
      ...statedMeasure(drinkText),
      drinkCategory,
      snippet,
      permalink: input.permalink,
      observedAt: input.observedAt,
      author: input.author,
      pubNameHint: localPub ?? unambiguousPub,
      areaHint: localPub ? extractAreaHint(snippet) : unambiguousArea,
    });
  }
  return out;
}

export type RedditListingComment = {
  id: string;
  body?: string;
  author?: string;
  created_utc?: number;
  permalink?: string;
};

export function commentsFromRedditThreadPayload(payload: unknown): RedditListingComment[] {
  const listing = Array.isArray(payload) ? payload[1] : null;
  const children = listing?.data?.children;
  if (!Array.isArray(children)) return [];
  const rows: RedditListingComment[] = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const kind = (node as { kind?: string }).kind;
      const data = (node as { data?: RedditListingComment & { replies?: unknown } }).data;
      if (kind === "t1" && data?.body) {
        rows.push({
          id: String(data.id ?? ""),
          body: data.body,
          author: data.author,
          created_utc: data.created_utc,
          permalink: data.permalink ? `https://www.reddit.com${data.permalink}` : undefined,
        });
        const replies = data.replies;
        if (replies && typeof replies === "object" && replies !== null) {
          const replyChildren = (replies as { data?: { children?: unknown[] } }).data?.children;
          if (Array.isArray(replyChildren)) walk(replyChildren);
        }
      }
    }
  };
  walk(children);
  return rows;
}
