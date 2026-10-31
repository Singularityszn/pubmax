// Pub crawl bingo (launch review F2). Each square ticks from its own recorded
// action on THIS night's plan and from nothing else; the count; the share line
// at nine; and the in-tab note pad only keeps notes while a plan is on.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CRAWL_BINGO_LABELS,
  CRAWL_BINGO_SQUARE_IDS,
  crawlBingoCountLine,
  crawlBingoShareLine,
  deriveCrawlBingo,
  heritageFactNamesAYear,
  type CrawlBingoInput,
  type CrawlBingoNote,
  type CrawlBingoNoteKind,
  type CrawlBingoSquareId,
} from "@/lib/crawlBingo";

const PLAN = "plan-tonight";
const OTHER_PLAN = "plan-last-week";

function input(overrides: Partial<CrawlBingoInput> = {}): CrawlBingoInput {
  return {
    planId: PLAN,
    stops: [
      { venueId: "lamb", position: 0, garden: false, darts: false },
      { venueId: "anchor", position: 1, garden: true, darts: false },
      { venueId: "flag", position: 2, garden: false, darts: true },
    ],
    arrivedPositions: [],
    cursor: 0,
    lastTrainVenueId: null,
    notes: [],
    ...overrides,
  };
}

function note(kind: CrawlBingoNoteKind, venueId = "lamb", planId = PLAN): CrawlBingoNote {
  return { planId, venueId, kind, at: 1 };
}

function ticked(value: CrawlBingoInput): CrawlBingoSquareId[] {
  return deriveCrawlBingo(value).squares.filter((s) => s.done).map((s) => s.id);
}

describe("crawl bingo squares", () => {
  it("has nine squares and none is about drinking", () => {
    expect(CRAWL_BINGO_SQUARE_IDS).toHaveLength(9);
    for (const label of Object.values(CRAWL_BINGO_LABELS)) {
      expect(label).not.toMatch(/\b(?:pint|pints|drink|drinks|drank|round|rounds|shot|shots|beer|lager|sesh|carnage|down)\b/i);
      expect(label).not.toMatch(/[—!]/);
    }
  });

  it("ticks nothing from an empty night", () => {
    const card = deriveCrawlBingo(input());
    expect(card.count).toBe(0);
    expect(card.fullHouse).toBe(false);
  });

  const noteSquares: [CrawlBingoNoteKind, CrawlBingoSquareId][] = [
    ["price", "price"],
    ["photo", "photo"],
    ["listed", "listed"],
    ["story", "story"],
    ["oldest", "oldest"],
    ["historyCard", "historyCard"],
  ];

  it.each(noteSquares)("ticks %s from its note at a stop on this plan, and only that square", (kind, square) => {
    expect(ticked(input({ notes: [note(kind, "anchor")] }))).toEqual([square]);
  });

  it.each(noteSquares)("does not tick %s from another plan's note or an off-route pub", (kind) => {
    expect(ticked(input({ notes: [note(kind, "anchor", OTHER_PLAN)] }))).toEqual([]);
    expect(ticked(input({ notes: [note(kind, "somewhere-else")] }))).toEqual([]);
  });

  it("ignores a note of an unknown kind", () => {
    const bogus = { planId: PLAN, venueId: "lamb", kind: "tap", at: 1 } as unknown as CrawlBingoNote;
    expect(ticked(input({ notes: [bogus] }))).toEqual([]);
  });

  it("ticks the last train only from the night card's read at a stop on the route", () => {
    expect(ticked(input({ lastTrainVenueId: "flag" }))).toEqual(["lastTrain"]);
    expect(ticked(input({ lastTrainVenueId: "somewhere-else" }))).toEqual([]);
  });

  it("ticks the garden from an arrival at a stop that lists one, never from a stop without", () => {
    expect(ticked(input({ arrivedPositions: [1] }))).toEqual(["garden"]);
    expect(ticked(input({ arrivedPositions: [0] }))).toEqual([]);
    // A "Here now" tap moves the cursor onto the garden stop.
    expect(ticked(input({ cursor: 1 }))).toEqual(["garden"]);
  });

  it("ticks the dartboard from an arrival at a stop that lists darts", () => {
    expect(ticked(input({ arrivedPositions: [2] }))).toEqual(["darts"]);
    expect(ticked(input({ cursor: 2 }))).toEqual(["garden", "darts"]);
  });

  it("does not count the first stop as an arrival before anyone taps", () => {
    const value = input({
      stops: [{ venueId: "lamb", position: 0, garden: true, darts: true }],
    });
    expect(ticked(value)).toEqual([]);
    expect(ticked({ ...value, arrivedPositions: [0] })).toEqual(["garden", "darts"]);
  });

  it("counts and offers the share line only at nine of nine", () => {
    const all = input({
      cursor: 2,
      lastTrainVenueId: "lamb",
      notes: noteSquares.map(([kind]) => note(kind)),
    });
    const card = deriveCrawlBingo(all);
    expect(card.count).toBe(9);
    expect(card.fullHouse).toBe(true);
    const short = deriveCrawlBingo({ ...all, lastTrainVenueId: null });
    expect(short.count).toBe(8);
    expect(short.fullHouse).toBe(false);
  });
});

describe("crawl bingo copy", () => {
  it("reads the count as n of 9", () => {
    expect(crawlBingoCountLine(3)).toBe("3 of 9");
    expect(crawlBingoCountLine(12)).toBe("9 of 9");
    expect(crawlBingoCountLine(-1)).toBe("0 of 9");
  });

  it("reads the full house line with one article", () => {
    expect(crawlBingoShareLine("Brass Compass")).toBe("Full house at the Brass Compass");
    expect(crawlBingoShareLine("The Brass Compass")).toBe("Full house at the Brass Compass");
    expect(crawlBingoShareLine("  ")).toBe("Full house on tonight's crawl");
  });

  it("finds a year in a heritage fact and not in a price", () => {
    expect(heritageFactNamesAYear("Built in 1724 as a coaching inn.")).toBe(true);
    expect(heritageFactNamesAYear("Grade II listed, 1972.")).toBe(true);
    expect(heritageFactNamesAYear("A pint here was £1999.50 once")).toBe(false);
    expect(heritageFactNamesAYear("No dates on record")).toBe(false);
  });
});

describe("crawl bingo night notes", () => {
  beforeEach(async () => {
    const { resetCrawlBingoNotesForTest } = await import("@/lib/crawlBingoNightLog");
    resetCrawlBingoNotesForTest();
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps a note only while a plan is on tonight, and names that plan", async () => {
    const store = new Map<string, string>();
    const listeners = new Set<() => void>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        dispatchEvent: () => {
          for (const fn of listeners) fn();
          return true;
        },
      },
    });
    const { noteCrawlBingoAction, readCrawlBingoNotes, subscribeCrawlBingoNotes } = await import(
      "@/lib/crawlBingoNightLog"
    );
    const now = Date.parse("2026-10-30T20:00:00.000Z");

    noteCrawlBingoAction("price", "lamb", now);
    expect(readCrawlBingoNotes()).toEqual([]);

    const id = "11111111-1111-4111-8111-111111111111";
    store.set("pubmax_active_plan", JSON.stringify({ version: 1, id, startTime: "2026-10-30T19:00:00.000Z", stopIndex: 0 }));
    let heard = 0;
    const off = subscribeCrawlBingoNotes(() => (heard += 1));
    noteCrawlBingoAction("price", "lamb", now);
    noteCrawlBingoAction("price", "lamb", now);
    off();
    expect(readCrawlBingoNotes()).toEqual([{ planId: id, venueId: "lamb", kind: "price", at: now }]);
    expect(heard).toBe(1);

    // A night long over keeps nothing.
    noteCrawlBingoAction("photo", "lamb", now + 3 * 24 * 60 * 60 * 1000);
    expect(readCrawlBingoNotes()).toHaveLength(1);
  });
});
