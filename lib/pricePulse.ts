// Price Pulse - what people are saying about pint and night-out prices this
// week, in PUBMAXX's own words, with a link out and a date on every line.
//
// An edition is one file, `data/price-pulse/<YYYY-MM-DD>.json`, registered in
// `lib/pricePulseEditions.ts`. A research agent drafts it with
// `approved: false` (`data/price-pulse/README.md` is the runbook) and the owner
// approves it. The page renders an approved edition and nothing else.
//
// HARD RULE - a Price Pulse figure is a claim, never a price.
//
//   A Social Post has no venue or price authority (CONTEXT.md), and a line
//   that retells a Reddit thread or a press story has less. So nothing here
//   may paint a map pin, enter a Price Lane, count as a Pint Drop, or reach any
//   module that answers "what does a pint cost here now".
//
//   Mechanically: an item carries NO numeric field at all. Every figure lives
//   inside its prose, so a merge that wanted a price would find no field to
//   read. This module and its registry are imported only by the
//   /price-pulse route, and `__tests__/pricePulse.test.tsx` pins both the import
//   fence and the shape.
//
// The parser is strict in the opposite direction from the price guards: one
// bad item refuses the WHOLE edition. An edition is a reviewed document, so a
// line the owner approved must not quietly vanish from it, and a line that is
// unsourced, undated, names a user or quotes too much is a draft error.

import { isHttpUrl } from "@/lib/httpUrl";
import { isNonBlankString } from "@/lib/priceUpdateRowShape";

const PRICE_PULSE_SCHEMA_VERSION = 1;

/** The label every line carries unless PUBMAXX holds a Confirmed price for it. */
export const NOT_CHECKED_LABEL = "Not checked by PUBMAXX";

/** A short attributed quote, never more. Longer than this is copying a post. */
export const MAX_QUOTE_WORDS = 15;
const MAX_QUOTE_CHARS = 110;

/** Who said it. Closed, and each kind has one plain label. */
const PRICE_PULSE_ITEM_KINDS = ["drinkers", "trade", "press"] as const;
export type PricePulseItemKind = (typeof PRICE_PULSE_ITEM_KINDS)[number];

const KIND_LABEL: Record<PricePulseItemKind, string> = {
  drinkers: "Drinkers online",
  trade: "The trade",
  press: "In the press",
};

export function pricePulseKindLabel(kind: PricePulseItemKind): string {
  return KIND_LABEL[kind];
}

export type PricePulseSource = {
  /** Where it was said, e.g. "r/london" or "SIBA". Never a username. */
  label: string;
  url: string;
  /** The calendar day the post or article was published, YYYY-MM-DD. */
  publishedOn: string;
};

type PricePulseQuote = {
  text: string;
  /** Who said it, without a name: "a reply in the same thread". */
  attribution: string;
};

export type PricePulseItem = {
  id: string;
  kind: PricePulseItemKind;
  /** PUBMAXX's own words. */
  said: string;
  quote?: PricePulseQuote;
  /**
   * The curated venue this line names, when the pub is on our map. It is
   * read ONE way: the page may print a Confirmed PUBMAXX price beside the
   * claim. The claim never travels back to the venue.
   */
  venueId?: string;
  source: PricePulseSource;
};

export type PricePulseEdition = {
  schemaVersion: typeof PRICE_PULSE_SCHEMA_VERSION;
  /** The edition's day, YYYY-MM-DD. It is also the file name. */
  edition: string;
  title: string;
  summary: string;
  /** The window the research read, inclusive calendar days. */
  windowStart: string;
  windowEnd: string;
  approved: boolean;
  /** ISO instant the owner approved it; null while it is a draft. */
  approvedAt: string | null;
  items: PricePulseItem[];
};

export type PricePulseParseResult =
  | { ok: true; edition: PricePulseEdition }
  | { ok: false; errors: string[] };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A Reddit username, an @handle or a "posted by" byline. We never store one.
const USERNAME_RE = /(?:^|[^A-Za-z0-9])(?:\/?u\/[A-Za-z0-9_-]{2,}|@[A-Za-z0-9_]{2,})|posted by/i;
// Neutral wording about venues. A figure is reported, never judged.
const LOADED_WORDS_RE =
  /\b(?:rip[\s-]?offs?|ripoffs?|scams?|scammers?|daylight robbery|extortionate|extortion|fleeced?|fleecing|greedy|con artists?)\b/i;

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function checkProse(field: string, value: unknown, errors: string[]): value is string {
  if (!isNonBlankString(value)) {
    errors.push(`${field} is missing`);
    return false;
  }
  if (USERNAME_RE.test(value)) errors.push(`${field} names a user`);
  if (LOADED_WORDS_RE.test(value)) errors.push(`${field} uses loaded wording about a venue`);
  return true;
}

function parseItem(raw: unknown, index: number, errors: string[]): PricePulseItem | null {
  const at = `items[${index}]`;
  if (!raw || typeof raw !== "object") {
    errors.push(`${at} is not an object`);
    return null;
  }
  const row = raw as Record<string, unknown>;
  const allowed = new Set(["id", "kind", "said", "quote", "venueId", "source"]);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) errors.push(`${at}.${key} is not a Price Pulse field`);
  }
  const before = errors.length;

  if (!isNonBlankString(row.id) || !ID_RE.test(row.id)) errors.push(`${at}.id must be a lower-case slug`);
  if (!PRICE_PULSE_ITEM_KINDS.includes(row.kind as PricePulseItemKind)) {
    errors.push(`${at}.kind must be one of ${PRICE_PULSE_ITEM_KINDS.join(", ")}`);
  }
  checkProse(`${at}.said`, row.said, errors);

  let quote: PricePulseQuote | undefined;
  if (row.quote !== undefined) {
    const q = row.quote as Record<string, unknown> | null;
    if (!q || typeof q !== "object") {
      errors.push(`${at}.quote is not an object`);
    } else {
      const textOk = checkProse(`${at}.quote.text`, q.text, errors);
      checkProse(`${at}.quote.attribution`, q.attribution, errors);
      if (textOk) {
        const text = q.text as string;
        if (wordCount(text) > MAX_QUOTE_WORDS || text.length > MAX_QUOTE_CHARS) {
          errors.push(`${at}.quote.text is longer than a short quote`);
        }
      }
      quote = { text: q.text as string, attribution: q.attribution as string };
    }
  }

  if (row.venueId !== undefined && !isNonBlankString(row.venueId)) {
    errors.push(`${at}.venueId must be a venue id`);
  }

  const source = row.source as Record<string, unknown> | null | undefined;
  if (!source || typeof source !== "object") {
    errors.push(`${at}.source is missing`);
  } else {
    checkProse(`${at}.source.label`, source.label, errors);
    if (!isHttpUrl(source.url) || !String(source.url).startsWith("https://")) {
      errors.push(`${at}.source.url must be an https link`);
    }
    if (!isCalendarDay(source.publishedOn)) errors.push(`${at}.source.publishedOn must be YYYY-MM-DD`);
  }

  if (errors.length > before) return null;
  return {
    id: row.id as string,
    kind: row.kind as PricePulseItemKind,
    said: row.said as string,
    ...(quote ? { quote } : {}),
    ...(row.venueId !== undefined ? { venueId: row.venueId as string } : {}),
    source: {
      label: (source as Record<string, unknown>).label as string,
      url: (source as Record<string, unknown>).url as string,
      publishedOn: (source as Record<string, unknown>).publishedOn as string,
    },
  };
}

/** Parse one edition file. Any error refuses the whole edition. */
export function parsePricePulseEdition(raw: unknown): PricePulseParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["edition is not an object"] };
  const file = raw as Record<string, unknown>;

  if (file.schemaVersion !== PRICE_PULSE_SCHEMA_VERSION) errors.push("schemaVersion must be 1");
  if (!isCalendarDay(file.edition)) errors.push("edition must be YYYY-MM-DD");
  checkProse("title", file.title, errors);
  checkProse("summary", file.summary, errors);
  if (!isCalendarDay(file.windowStart)) errors.push("windowStart must be YYYY-MM-DD");
  if (!isCalendarDay(file.windowEnd)) errors.push("windowEnd must be YYYY-MM-DD");
  if (isCalendarDay(file.windowStart) && isCalendarDay(file.windowEnd) && file.windowStart > file.windowEnd) {
    errors.push("windowStart is after windowEnd");
  }

  // Approval is a literal `true` with the instant beside it. Anything else is
  // a draft, and a draft that claims an approval time is a contradiction.
  if (typeof file.approved !== "boolean") errors.push("approved must be true or false");
  if (file.approved === true && !isInstant(file.approvedAt)) {
    errors.push("an approved edition needs approvedAt");
  }
  if (file.approved === false && file.approvedAt !== null) {
    errors.push("a draft carries approvedAt: null");
  }

  if (!Array.isArray(file.items) || file.items.length === 0) {
    errors.push("items must be a non-empty list");
  }
  const items: PricePulseItem[] = [];
  const ids = new Set<string>();
  if (Array.isArray(file.items)) {
    file.items.forEach((rawItem, index) => {
      const item = parseItem(rawItem, index, errors);
      if (!item) return;
      if (ids.has(item.id)) errors.push(`items[${index}].id repeats ${item.id}`);
      ids.add(item.id);
      items.push(item);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    edition: {
      schemaVersion: PRICE_PULSE_SCHEMA_VERSION,
      edition: file.edition as string,
      title: file.title as string,
      summary: file.summary as string,
      windowStart: file.windowStart as string,
      windowEnd: file.windowEnd as string,
      approved: file.approved as boolean,
      approvedAt: (file.approvedAt as string | null) ?? null,
      items,
    },
  };
}

/** True only for an edition the owner has approved. The one render gate. */
function isPublishable(edition: PricePulseEdition): boolean {
  return edition.approved === true && isInstant(edition.approvedAt);
}

/**
 * The editions a reader may see: parsed, approved, latest first. A file that
 * fails to parse is refused here rather than half-shown.
 */
export function publishedEditions(raws: readonly unknown[]): PricePulseEdition[] {
  return raws
    .map((raw) => parsePricePulseEdition(raw))
    .flatMap((result) => (result.ok && isPublishable(result.edition) ? [result.edition] : []))
    .sort((a, b) => (a.edition < b.edition ? 1 : a.edition > b.edition ? -1 : 0));
}

/**
 * The day the page last changed for a reader: the newest approval, or the
 * explainer's own review day when no edition is published yet.
 */
export function pricePulseLastModified(editions: readonly PricePulseEdition[], explainerReviewedOn: string): Date {
  const approvals = editions.flatMap((edition) => (edition.approvedAt ? [Date.parse(edition.approvedAt)] : []));
  const floor = Date.parse(`${explainerReviewedOn}T00:00:00Z`);
  return new Date(Math.max(floor, ...approvals));
}

/** "2 October 2026" from a calendar day, read in UTC so the day never shifts. */
export function formatPulseDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
