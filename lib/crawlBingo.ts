// Pub crawl bingo (launch review F2): nine squares for the night, none about
// drinking. The PUBMAXX Promise is that a night is measured by the life around
// the drink, never by how much you drank, so no square counts a pint, a round
// or a drink of any kind. Each square is about the pub.
//
// A SQUARE TICKS ONLY FROM A RECORDED ACTION ON THIS NIGHT'S PLAN. The card
// that draws these squares has no tap on a square at all, and this leaf takes
// no "done" flag from anyone: every tick is derived here from a record that an
// existing surface already made, and only when that record names a stop on the
// active plan. A record for another plan, or for a pub that is not on the
// route, ticks nothing.
//
// Pure: no window, no storage, no fetch. The in-tab notes it reads are written
// by lib/crawlBingoNightLog.ts, and the plan, the cursor and the last-train read
// are handed over by the Night Mode card that already holds them.

/** A venue-sheet action that an existing surface notes for the active plan. */
const CRAWL_BINGO_NOTE_KINDS = [
  // VenuePriceSubmit: the server kept a price for this pub.
  "price",
  // VenuePhotoComposer: a photo landed on this pub's wall.
  "photo",
  // VenueStoryTab: the person opened the listed-building source link.
  "listed",
  // LandlordPanel: the person asked the pub's story and got an answer.
  "story",
  // VenueStoryTab: a dated fact (a listed or founding year) was read on the
  // open Lore tab.
  "oldest",
  // VenueStoryTab: the person opened the pub's Lore tab, its history card.
  "historyCard",
] as const;

export type CrawlBingoNoteKind = (typeof CRAWL_BINGO_NOTE_KINDS)[number];

export type CrawlBingoNote = {
  planId: string;
  venueId: string;
  kind: CrawlBingoNoteKind;
  at: number;
};

export function isCrawlBingoNoteKind(value: unknown): value is CrawlBingoNoteKind {
  return (CRAWL_BINGO_NOTE_KINDS as readonly unknown[]).includes(value);
}

export const CRAWL_BINGO_SQUARE_IDS = [
  "price",
  "photo",
  "lastTrain",
  "listed",
  "story",
  "garden",
  "darts",
  "oldest",
  "historyCard",
] as const;

export type CrawlBingoSquareId = (typeof CRAWL_BINGO_SQUARE_IDS)[number];

export const CRAWL_BINGO_SIZE = CRAWL_BINGO_SQUARE_IDS.length;

/**
 * The words on each square. The review asked for "find a fireplace" and
 * "teach a stranger the mug check". The venue model records no fireplace, so
 * that square reads the dartboard amenity instead; and no mug-check surface
 * exists yet, so that square is the pub's history card.
 */
export const CRAWL_BINGO_LABELS: Record<CrawlBingoSquareId, string> = {
  price: "Log one price here",
  photo: "Take a photo for the pub's wall",
  lastTrain: "Work out the last train",
  listed: "Find the listed-building plaque",
  story: "Ask the bar staff the pub's story",
  garden: "Sit in the garden",
  darts: "Find the dartboard",
  oldest: "Spot the oldest thing in the pub",
  historyCard: "Read the pub's history card",
};

export type CrawlBingoStop = {
  venueId: string;
  /** The stop's position on the route, as plan actions name it. */
  position: number;
  /** The venue lists a beer garden. */
  garden: boolean;
  /** The venue lists darts. */
  darts: boolean;
};

export type CrawlBingoInput = {
  planId: string;
  /** The active plan's stops, in route order. */
  stops: readonly CrawlBingoStop[];
  /** Stop positions with a recorded "arrived" plan action ("I'm here"). */
  arrivedPositions: readonly number[];
  /**
   * The Night Mode cursor. It only moves on a "Here now" tap, so every stop
   * after the first, up to and including the cursor, was tapped into.
   */
  cursor: number;
  /** The stop venue the Night Mode card read a leave-by time for, if any. */
  lastTrainVenueId: string | null;
  /** In-tab notes from the venue sheet, for any plan. */
  notes: readonly CrawlBingoNote[];
};

type CrawlBingoSquare = {
  id: CrawlBingoSquareId;
  label: string;
  done: boolean;
};

export type CrawlBingoCard = {
  squares: CrawlBingoSquare[];
  count: number;
  fullHouse: boolean;
};

function arrivedStops(input: CrawlBingoInput): CrawlBingoStop[] {
  const arrived = new Set(input.arrivedPositions);
  const cursor = Number.isFinite(input.cursor) ? Math.floor(input.cursor) : 0;
  return input.stops.filter(
    (stop, index) => arrived.has(stop.position) || (index >= 1 && index <= cursor),
  );
}

/** Derive the nine squares from this night's records, and from nothing else. */
export function deriveCrawlBingo(input: CrawlBingoInput): CrawlBingoCard {
  const stopIds = new Set(input.stops.map((stop) => stop.venueId));
  const noted = new Set<CrawlBingoNoteKind>();
  for (const note of input.notes) {
    if (note.planId !== input.planId) continue;
    if (!stopIds.has(note.venueId)) continue;
    if (!isCrawlBingoNoteKind(note.kind)) continue;
    noted.add(note.kind);
  }
  const here = arrivedStops(input);
  const done: Record<CrawlBingoSquareId, boolean> = {
    price: noted.has("price"),
    photo: noted.has("photo"),
    lastTrain: input.lastTrainVenueId !== null && stopIds.has(input.lastTrainVenueId),
    listed: noted.has("listed"),
    story: noted.has("story"),
    garden: here.some((stop) => stop.garden),
    darts: here.some((stop) => stop.darts),
    oldest: noted.has("oldest"),
    historyCard: noted.has("historyCard"),
  };
  const squares = CRAWL_BINGO_SQUARE_IDS.map((id) => ({
    id,
    label: CRAWL_BINGO_LABELS[id],
    done: done[id],
  }));
  const count = squares.filter((square) => square.done).length;
  return { squares, count, fullHouse: count === CRAWL_BINGO_SIZE };
}

/** "3 of 9". */
export function crawlBingoCountLine(count: number): string {
  const n = Math.max(0, Math.min(CRAWL_BINGO_SIZE, Math.floor(count)));
  return `${n} of ${CRAWL_BINGO_SIZE}`;
}

/**
 * The share line at nine of nine: "Full house at the {plan title}". A title
 * that already opens with "The" keeps one article, so "The Brass Compass"
 * reads "Full house at the Brass Compass".
 */
export function crawlBingoShareLine(planTitle: string): string {
  const title = planTitle.trim().replace(/^the\s+/i, "");
  return title ? `Full house at the ${title}` : "Full house on tonight's crawl";
}

/**
 * Does a heritage fact read on the sheet name a year? A listed date or a
 * founding year ("Built in 1724", "Grade II, listed 1972") is the oldest thing
 * the sheet can point at. Years from 1000 to 2099 count, standing alone as four
 * digits; a price or a longer number does not.
 */
export function heritageFactNamesAYear(fact: string): boolean {
  return /(?<![\d£.,])\b(?:1\d{3}|20\d{2})\b(?![\d.,]\d)/.test(fact);
}
