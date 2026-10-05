// Pubs people are talking about: the rows Tonight leads with.
//
// A row here is a pub somebody wrote about somewhere public, on a day we can
// name, with the link still in the row. There is no crawl behind it and no
// model writing the sentence: `scripts/hyped-pubs-ingest.mjs` turns a research
// file into `public/data/hyped/london.json` and this module is the shape both
// sides read.
//
// THREE RULES, and each one is a guard below rather than a note.
//
//   1. A ROW WITHOUT A SOURCE IS NOT A ROW. Every row prints one credit, so a
//      row carrying no dated http source is dropped rather than shown bare.
//      That is the same bar `lib/priceHistory.ts` holds an archival price to.
//   2. A PUB WE CANNOT MATCH STILL COUNTS. `venueId` is optional on purpose:
//      the pubs people talk about are new, and a new pub is exactly the one our
//      curated index has not got yet. An unmatched row shows with no pub link
//      and says so, which is honest about our own coverage.
//   3. THE FILE ORDERS THE LIST AND NEVER RATES A PUB. `score` and `mentions`
//      sort the rows. Neither is ever printed: they are one researcher's
//      reading of how loud a pub is, and a number on a screen reads as a
//      measurement.

import type { Route } from "next";
import { isHttpUrl } from "@/lib/httpUrl";
import { isNonBlankString } from "@/lib/priceUpdateRowShape";

/** One place the talk was found, and the day it was read. */
export type HypedPubSource = {
  /** How the publisher is named on screen, e.g. "r/london". */
  label: string;
  url: string;
  /** ISO instant the researcher read the page. */
  observedAt: string;
};

export type HypedPub = {
  name: string;
  /** London area in the words a drinker uses, e.g. "Peckham". */
  area: string;
  /** Our own venue id when the pub is on the map, else null. */
  venueId: string | null;
  /** One sentence saying what people are saying. */
  whyLine: string;
  sources: HypedPubSource[];
  /** The researcher's own ranking weight. Orders the list, never printed. */
  score: number;
  /** How many separate mentions the row was built from. Never printed. */
  mentions: number;
};

export type HypedPubsFile = {
  /** The day the published file was written. */
  generatedAt: string | null;
  rows: HypedPub[];
};

export const EMPTY_HYPED_PUBS: HypedPubsFile = Object.freeze({
  generatedAt: null,
  rows: [],
});

/** What the lede says above the rows. */
export const HYPED_PUBS_TITLE = "Pubs people are talking about";

/** What a row says when the pub is not in our own index yet. */
export const HYPED_PUB_UNMATCHED_LINE = "Not on our map yet";

/** How many rows the first screen carries before the rest fold away. */
export const HYPED_PUBS_VISIBLE = 5;

/**
 * How many rows reach the page at all.
 *
 * `/tonight` is PRERENDERED, so every row in the document is served to every
 * reader whether they open the fold or not. The pack holds the whole city's
 * talk (48 rows on 7 September 2026, three sources each, 33 KB of JSON); the
 * page takes the loudest few and the ONE credit each of them prints.
 */
export const HYPED_PUBS_PAGE_LIMIT = 12;

function isDatedIso(value: unknown): value is string {
  return isNonBlankString(value) && Number.isFinite(Date.parse(value));
}

function parseSource(value: unknown): HypedPubSource | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isNonBlankString(raw.label)) return null;
  if (!isHttpUrl(raw.url, { allowWhitespace: true })) return null;
  if (!isDatedIso(raw.observedAt)) return null;
  return {
    label: raw.label.trim(),
    url: raw.url,
    observedAt: raw.observedAt,
  };
}

function parseRow(value: unknown): HypedPub | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isNonBlankString(raw.name)) return null;
  if (!isNonBlankString(raw.area)) return null;
  if (!isNonBlankString(raw.whyLine)) return null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .map(parseSource)
        .filter((source): source is HypedPubSource => source !== null)
    : [];
  if (sources.length === 0) return null;
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0;
  const mentions =
    typeof raw.mentions === "number" && Number.isFinite(raw.mentions)
      ? Math.max(1, Math.floor(raw.mentions))
      : sources.length;
  return {
    name: raw.name.trim(),
    area: raw.area.trim(),
    venueId: isNonBlankString(raw.venueId) ? raw.venueId.trim() : null,
    whyLine: raw.whyLine.trim(),
    sources,
    score,
    mentions,
  };
}

/** Read the published file. A malformed row is dropped, never repaired. */
export function parseHypedPubs(value: unknown): HypedPubsFile {
  if (typeof value !== "object" || value === null) return EMPTY_HYPED_PUBS;
  const raw = value as Record<string, unknown>;
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map(parseRow).filter((row): row is HypedPub => row !== null)
    : [];
  return {
    generatedAt: isDatedIso(raw.generatedAt) ? raw.generatedAt : null,
    rows: orderHypedPubs(rows),
  };
}

/**
 * Loudest first, then most mentions, then by name so two equal rows keep one
 * order on every machine.
 */
export function orderHypedPubs(rows: readonly HypedPub[]): HypedPub[] {
  return [...rows].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.mentions !== left.mentions) return right.mentions - left.mentions;
    return left.name.localeCompare(right.name, "en-GB");
  });
}

/** The one source a row credits: the freshest reading we hold for it. */
export function hypedPubCredit(row: HypedPub): HypedPubSource | null {
  let best: HypedPubSource | null = null;
  for (const source of row.sources) {
    if (!best || Date.parse(source.observedAt) > Date.parse(best.observedAt)) {
      best = source;
    }
  }
  return best;
}

/**
 * The pub's own page on our map, or null.
 *
 * A row is only linked when the eager index says the map can really open it,
 * the rule `lib/tonightOutListings.ts` already applies to a listing row: a link
 * to a pin that will not open is worse than no link.
 */
export function hypedPubMapHref(
  row: HypedPub,
  selectable: ReadonlySet<string> | null | undefined,
): Route | null {
  if (!row.venueId) return null;
  if (selectable === null) return null;
  if (selectable !== undefined && !selectable.has(row.venueId)) return null;
  return `/map?sel=${encodeURIComponent(row.venueId)}`;
}

/** The loudest rows, each carrying only the credit its card prints. */
export function hypedPubsForPage(
  rows: readonly HypedPub[],
  limit: number = HYPED_PUBS_PAGE_LIMIT,
): HypedPub[] {
  return orderHypedPubs(rows)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((row) => {
      const credit = hypedPubCredit(row);
      return { ...row, sources: credit ? [credit] : [] };
    });
}
