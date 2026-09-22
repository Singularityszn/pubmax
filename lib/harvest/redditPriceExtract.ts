// Deterministic extraction of drink-price candidates from Reddit comment bodies.

import { drinkCategoryFromText, drinkTaxonomyFromText } from "@/lib/drinkCategoryFromText";
import {
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  roundToPennies,
} from "@/lib/communityPrice";

export type RedditPriceCandidate = {
  priceGbp: number;
  priceText: string;
  drinkText: string;
  drinkCategory: NonNullable<ReturnType<typeof drinkCategoryFromText>>;
  snippet: string;
  permalink: string;
  observedAt: string;
  author: string;
  pubNameHint: string | null;
  areaHint: string | null;
};

const POUND_RE = /£\s*(\d{1,2}(?:\.\d{1,2})?)/g;
const JOKE_OR_HYPOTHETICAL =
  /\b(wish|would be|should be|used to be|remember when|in my day|if only|imagine|probably|maybe|about|around|ish)\b/i;
const RETROSPECTIVE = /\b(remember when|used to (?:be|cost|pay)|in my day|back in \d{4}|years? ago)\b/i;

export function isRetrospectiveRedditPrice(text: string): boolean {
  return RETROSPECTIVE.test(text);
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

function snippetAround(text: string, index: number, radius = 120): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
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
  const m = body.match(LONDON_AREA_RE);
  return m ? m[1] : null;
}

function drinkLabelNear(body: string, poundIndex: number): string {
  const window = body.slice(Math.max(0, poundIndex - 80), poundIndex + 40);
  const taxonomy = drinkTaxonomyFromText(window);
  if (taxonomy?.subtype) return taxonomy.subtype;
  const pint = window.match(/\b(pint|guinness|lager|ale|cider|stout|ipa|cocktail|wine|gin|whisky|vodka|rum|coffee)\b/i);
  return pint ? pint[1] : "pint";
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

  const pubNameHint = extractPubNameHint(body);
  const areaHint = extractAreaHint(body);
  const out: RedditPriceCandidate[] = [];
  let match: RegExpExecArray | null;
  POUND_RE.lastIndex = 0;
  while ((match = POUND_RE.exec(body)) !== null) {
    const priceGbp = roundToPennies(Number(match[1]));
    if (priceGbp < COMMUNITY_PRICE_MIN_GBP || priceGbp > COMMUNITY_PRICE_MAX_GBP) continue;
    const snippet = snippetAround(body, match.index);
    if (JOKE_OR_HYPOTHETICAL.test(snippet) && !PAID_OR_SAW.test(snippet)) continue;
    const drinkText = drinkLabelNear(body, match.index);
    const drinkCategory = drinkCategoryFromText(drinkText) ?? drinkCategoryFromText(body);
    if (!drinkCategory) continue;
    out.push({
      priceGbp,
      priceText: match[0].replace(/\s+/g, ""),
      drinkText,
      drinkCategory,
      snippet,
      permalink: input.permalink,
      observedAt: input.observedAt,
      author: input.author,
      pubNameHint,
      areaHint,
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
