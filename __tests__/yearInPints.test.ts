// The Year in Pints share (lib/yearInPints.ts): the link carries only the
// lines the person ticked, every value in it is checked on its own, and the
// words on the shared card are never a score.

import { describe, expect, it } from "vitest";

import { palYearFacts, type PalYearCrawl, type PalYearFacts } from "@/lib/palYear";
import { buildYearInPintsShareText } from "@/lib/shareArtifacts";
import {
  DEFAULT_YEAR_SHARE_PARTS,
  YEAR_SHARE_PARTS,
  isYearInPintsSeason,
  parseYearShare,
  yearShareCardPath,
  yearShareFrom,
  yearShareHeading,
  yearShareLines,
  yearShareOffer,
  yearSharePath,
  yearShareQuery,
  yearShareSpan,
  yearShareVenueIds,
  type YearShare,
} from "@/lib/yearInPints";

function crawl(day: string, stopIds: string[]): PalYearCrawl {
  return { stopIds, visited: stopIds, startedAt: `${day}T19:00:00.000Z`, completedAt: `${day}T22:30:00.000Z` };
}

function fullYear(): PalYearFacts {
  return palYearFacts({
    year: 2026,
    nightsKeptDays: ["2026-02-20", "2026-10-03", "2026-10-17"],
    crawls: [crawl("2026-02-20", ["venue-lamb", "venue-crown"]), crawl("2026-10-17", ["venue-crown", "venue-z"])],
    contributions: { pricesMapped: 12, boroughs: 3 },
  });
}

const NAMES = { "venue-crown": "The Crown", "venue-lamb": "The Lamb" };
const TODAY = "2026-10-28";

function read(share: YearShare, today = TODAY): YearShare | null {
  return parseYearShare(String(share.year), new URLSearchParams(yearShareQuery(share)), today);
}

describe("what the year can offer for the card", () => {
  it("offers every line the year holds, and a favourite only once its name is known", () => {
    expect(yearShareOffer(fullYear(), NAMES)).toEqual([...YEAR_SHARE_PARTS]);
    expect(yearShareOffer(fullYear(), {})).not.toContain("favourite");
    expect(yearShareOffer(fullYear(), {})).not.toContain("first");
  });

  it("offers no busiest month for a single night, and nothing from an empty year", () => {
    const one = palYearFacts({ year: 2026, nightsKeptDays: ["2026-03-07"], crawls: [], contributions: null });
    expect(yearShareOffer(one, {})).toEqual(["nights", "first"]);
    const empty = palYearFacts({ year: 2026, nightsKeptDays: [], crawls: [], contributions: null });
    expect(yearShareOffer(empty, {})).toEqual([]);
    expect(yearShareFrom(empty, new Set(YEAR_SHARE_PARTS), TODAY, NAMES)).toBeNull();
  });

  it("ticks the counts and leaves a line naming a pub or a day for the person to tick", () => {
    expect(DEFAULT_YEAR_SHARE_PARTS).toEqual(["nights", "month", "stops", "prices"]);
  });
});

describe("the link carries only what was ticked", () => {
  it("holds the ticked lines and nothing else", () => {
    const share = yearShareFrom(fullYear(), new Set(["nights", "prices"]), TODAY, NAMES);
    expect(share).toEqual({ year: 2026, through: 10, nights: 3, prices: { count: 12, boroughs: 3 } });
    expect(yearSharePath(share!)).toBe("/year-in-pints/2026?to=10&n=3&p=12&b=3");
    expect(yearShareCardPath(share!)).toBe("/api/year-card?y=2026&to=10&n=3&p=12&b=3");
    expect(yearSharePath(share!)).not.toMatch(/venue|handle|pal/);
  });

  it("withholds venue-backed selections until their names are visible", () => {
    expect(yearShareFrom(fullYear(), new Set(["first", "favourite"]), TODAY, {})).toBeNull();
    const dateOnly = { ...fullYear(), firstNight: { day: "2026-02-20", firstStopVenueId: null } };
    const share = yearShareFrom(dateOnly, new Set(["first"]), TODAY, {});
    expect(share).toEqual({ year: 2026, through: 10, first: { day: "2026-02-20", venueId: null } });
    expect(yearShareQuery(share!)).toBe("to=10&fd=02-20");
    expect(yearShareLines(read(share!)!, NAMES)).toEqual(["First night out: 20 February."]);
    expect(yearShareVenueIds(share!)).toEqual([]);
  });

  it("keeps a selected busiest month without the unticked night count", () => {
    const share = yearShareFrom(fullYear(), new Set(["month"]), TODAY, NAMES)!;
    expect(read(share)).toEqual({ year: 2026, through: 10, month: 10 });
    expect(yearShareLines(read(share)!, {})).toEqual(["October was the busiest month."]);
  });

  it("answers null when nothing ticked is there to send", () => {
    expect(yearShareFrom(fullYear(), new Set(), TODAY, NAMES)).toBeNull();
  });

  it("reads a past year as a whole year", () => {
    expect(yearShareFrom(fullYear(), new Set(["nights"]), "2027-01-02", NAMES)?.through).toBe(12);
  });

  it("reads back every line it carried", () => {
    const share = yearShareFrom(fullYear(), new Set(YEAR_SHARE_PARTS), TODAY, NAMES)!;
    expect(share.favourite).toEqual({ venueId: "venue-crown", visits: 2 });
    expect(share.first).toEqual({ day: "2026-02-20", venueId: "venue-lamb" });
    expect(read(share)).toEqual(share);
    expect(yearShareVenueIds(share)).toEqual(["venue-crown", "venue-lamb"]);
  });
});

describe("a link is checked value by value", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("refuses a year before the wrap, a year to come, and a month not reached yet", () => {
    expect(parseYearShare("2025", params("to=10&n=3"), TODAY)).toBeNull();
    expect(parseYearShare("2027", params("to=10&n=3"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=11&n=3"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("n=3"), TODAY)).toBeNull();
    expect(parseYearShare("26", params("to=10&n=3"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=12&n=3"), "2027-01-01")).toEqual({ year: 2026, through: 12, nights: 3 });
  });

  it("drops a count no year could hold rather than clamping it into a claim", () => {
    expect(parseYearShare("2026", params("to=10&n=999&s=4"), TODAY)).toEqual({ year: 2026, through: 10, stops: 4 });
    expect(parseYearShare("2026", params("to=10&n=-3&s=1.5&p=0"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=10&n=3e2"), TODAY)).toBeNull();
  });

  it("checks the busiest month independently against the month read to", () => {
    expect(parseYearShare("2026", params("to=10&n=3&m=11"), TODAY)).toEqual({ year: 2026, through: 10, nights: 3 });
    expect(parseYearShare("2026", params("to=10&n=1&m=4"), TODAY)).toEqual({ year: 2026, through: 10, nights: 1, month: 4 });
    expect(parseYearShare("2026", params("to=10&m=4"), TODAY)).toEqual({ year: 2026, through: 10, month: 4 });
    expect(parseYearShare("2026", params("to=10&m=11"), TODAY)).toBeNull();
  });

  it("names a pub by an id shape only, and a first night only on a real day", () => {
    expect(parseYearShare("2026", params("to=10&fv=<b>Hi</b>&fc=3"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=10&fv=venue-crown&fc=1"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=10&fd=02-30"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=10&fd=11-02"), TODAY)).toBeNull();
    expect(parseYearShare("2026", params("to=10&fd=02-20&fs=The%20Crown"), TODAY)).toEqual({
      year: 2026,
      through: 10,
      first: { day: "2026-02-20", venueId: null },
    });
  });
});

describe("the words on the shared card", () => {
  it("speaks one fact a line, and leaves out a pub with no known name", () => {
    const share = yearShareFrom(fullYear(), new Set(YEAR_SHARE_PARTS), TODAY, NAMES)!;
    expect(yearShareLines(share, NAMES)).toEqual([
      "3 nights out.",
      "October was the busiest month.",
      "4 stops walked.",
      "Kept coming back to The Crown. 2 crawls in all.",
      "First night out: 20 February, at The Lamb.",
      "12 prices mapped across 3 boroughs. Every one helps the next person.",
    ]);
    expect(yearShareLines(share, {})).toEqual([
      "3 nights out.",
      "October was the busiest month.",
      "4 stops walked.",
      "First night out: 20 February.",
      "12 prices mapped across 3 boroughs. Every one helps the next person.",
    ]);
  });

  it("reads a year so far until December", () => {
    expect(yearShareHeading({ year: 2026, through: 10 })).toBe("My 2026 so far");
    expect(yearShareSpan({ through: 10 })).toBe("January to October");
    expect(yearShareSpan({ through: 1 })).toBe("January");
    expect(yearShareHeading({ year: 2026, through: 12 })).toBe("My 2026 in pints");
    expect(yearShareSpan({ through: 12 })).toBeNull();
    expect(isYearInPintsSeason("2026-12-01")).toBe(true);
    expect(isYearInPintsSeason("2026-11-30")).toBe(false);
  });

  it("is never a score: no streak, no rank, no pints drunk, no shouting", () => {
    const share = yearShareFrom(fullYear(), new Set(YEAR_SHARE_PARTS), TODAY, NAMES)!;
    const text = [
      ...yearShareLines(share, NAMES),
      buildYearInPintsShareText({ heading: yearShareHeading(share), nights: 3, stops: 4, prices: 12 }),
    ].join(" ");
    expect(text).not.toMatch(/streak|rank|level|points|pints? (drunk|had)|in a row|!|—/i);
  });

  it("puts only the ticked counts in the message", () => {
    expect(buildYearInPintsShareText({ heading: "My 2026 so far", nights: 3, prices: 1 })).toBe(
      "My 2026 so far: 3 nights out, 1 price mapped. Read yours on PUBMAXX.",
    );
    expect(buildYearInPintsShareText({ heading: "My 2026 in pints" })).toBe("My 2026 in pints. Read yours on PUBMAXX.");
  });
});
