import { describe, expect, it } from "vitest";

import {
  OUT_DAY_WINDOWS,
  OUT_LISTING_KINDS,
  OUT_OPEN_PLANS_PLACEHOLDER_LINE,
  OUT_OPEN_PLANS_WAY_LABEL,
  filterOutListings,
  outCardObservedAt,
  outListingsEmptyLine,
  parseOutDayWindow,
  selectOutListings,
} from "@/lib/outListings";
import { WHATS_ON_KINDS, type WhatsOnRow } from "@/lib/whatsOn";

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "kind" | "title">): WhatsOnRow {
  return {
    placeName: "The Test Arms",
    source: { label: "Test listings", url: "https://example.com/listings" },
    observedAt: "2026-08-14T12:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

describe("out listings", () => {
  it("defaults an unknown chip to tonight", () => {
    expect(parseOutDayWindow(null)).toBe("tonight");
    expect(parseOutDayWindow("weekend")).toBe("weekend");
    expect(parseOutDayWindow("handle-like")).toBe("tonight");
  });

  it("keeps music, quiz and sport and drops deals", () => {
    const now = Date.parse("2026-08-14T18:00:00.000Z");
    const rows = [
      row({ id: "quiz-1", kind: "quiz", title: "Quiz", startsAt: "2026-08-14T19:00:00.000Z" }),
      row({ id: "deal-1", kind: "deal", title: "Deal", startsAt: "2026-08-14T19:00:00.000Z" }),
      row({ id: "music-1", kind: "music", title: "Gig", startsAt: "2026-08-14T20:00:00.000Z" }),
    ];
    expect(filterOutListings(rows, "tonight", now).map((item) => item.id)).toEqual([
      "quiz-1",
      "music-1",
    ]);
  });

  it("puts a Saturday start on the weekend chip, not tomorrow, from a Friday", () => {
    const fridayAfternoon = Date.parse("2026-08-14T15:00:00.000Z");
    const rows = [
      row({ id: "sat-quiz", kind: "quiz", title: "Saturday quiz", startsAt: "2026-08-15T19:00:00.000Z" }),
      row({ id: "sun-gig", kind: "music", title: "Sunday gig", startsAt: "2026-08-16T20:00:00.000Z" }),
    ];
    expect(filterOutListings(rows, "tomorrow", fridayAfternoon).map((item) => item.id)).toEqual([
      "sat-quiz",
    ]);
    expect(filterOutListings(rows, "weekend", fridayAfternoon).map((item) => item.id)).toEqual([
      "sat-quiz",
      "sun-gig",
    ]);
  });

  // The dataset is concatenated by family (quiz, then deals, then sport, then
  // music), so the rows this page wants sit past hundreds it discards. A cap
  // spent before the filter dropped every gig and printed "no listings" over a
  // city that had them.
  it("spends the cap on rows this page shows, never on rows it discards", () => {
    const now = Date.parse("2026-08-14T18:00:00.000Z");
    const rows = [
      ...Array.from({ length: 20 }, (_unused, index) =>
        row({
          id: `deal-${index}`,
          kind: "deal",
          title: "Deal",
          startsAt: "2026-08-14T19:00:00.000Z",
        }),
      ),
      row({ id: "music-1", kind: "music", title: "Gig", startsAt: "2026-08-14T20:00:00.000Z" }),
    ];
    expect(selectOutListings(rows, "tonight", now, 5).map((item) => item.id)).toEqual([
      "music-1",
    ]);
  });

  it("caps what is left once the window has been applied", () => {
    const now = Date.parse("2026-08-14T18:00:00.000Z");
    const rows = Array.from({ length: 8 }, (_unused, index) =>
      row({
        id: `quiz-${index}`,
        kind: "quiz",
        title: "Quiz",
        startsAt: "2026-08-14T19:00:00.000Z",
      }),
    );
    expect(selectOutListings(rows, "tonight", now, 3)).toHaveLength(3);
  });
});

// A card is one row. The per-kind map is a MAXIMUM across every row of that
// kind, so printing it on a card dated a July artifact with whatever the
// freshest row of the same kind was observed at.
describe("what day one card may print", () => {
  it("prints the row's own day, not the freshest day of its kind", () => {
    const bundled = row({
      id: "music-1",
      kind: "music",
      title: "Gig",
      observedAt: "2026-07-18T09:00:00.000Z",
    });
    expect(outCardObservedAt(bundled, { music: "2026-08-16T11:00:00.000Z" })).toBe(
      "2026-07-18T09:00:00.000Z",
    );
  });

  it("falls back to the kind's day only when the row carries none", () => {
    const undated = { kind: "quiz", observedAt: undefined } as const;
    expect(outCardObservedAt(undated, { quiz: "2026-08-01T00:00:00.000Z" })).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    const unparseable = { kind: "quiz", observedAt: "not a date" } as const;
    expect(outCardObservedAt(unparseable, { quiz: "2026-08-01T00:00:00.000Z" })).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("borrows nobody else's day when it cannot answer", () => {
    expect(outCardObservedAt({ kind: "sport", observedAt: undefined }, {})).toBeNull();
    expect(
      outCardObservedAt({ kind: "sport", observedAt: undefined }, { music: "2026-08-16T11:00:00.000Z" }),
    ).toBeNull();
  });
});

describe("out listings empty line", () => {
  // A read that could not answer and a window with nothing in it are two
  // findings, and one sentence for both tells a reader the city is quiet when
  // the truth is that we never looked.
  it("separates a quiet window from a read that could not answer", () => {
    const quiet = outListingsEmptyLine("ready", "tonight");
    const degraded = outListingsEmptyLine("degraded", "tonight");
    expect(quiet).not.toBe(degraded);
    expect(quiet).toMatch(/nothing listed for tonight yet/i);
    expect(degraded).toMatch(/could not check/i);
    for (const line of [quiet, degraded]) {
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/!/);
    }
  });

  it("names the window it is actually about", () => {
    // "Nothing listed for tonight" over the Weekend chip is a claim about the
    // wrong day.
    expect(outListingsEmptyLine("ready", "tomorrow")).toMatch(/tomorrow/i);
    expect(outListingsEmptyLine("ready", "weekend")).toMatch(/the weekend/i);
    expect(outListingsEmptyLine("ready", "weekend")).not.toMatch(/tonight/i);
  });

  it("says the same thing about a failed read whatever the window", () => {
    const lines = OUT_DAY_WINDOWS.map((window) => outListingsEmptyLine("degraded", window));
    expect(new Set(lines).size).toBe(1);
  });
});

// Nothing on /out reads the viewer's plans yet, so the section may not claim
// they have none: a signed-in drinker holding an open Soft Plan was told on the
// new primary tab that they had none, which is the shape of calling a city
// priceless under a read that never ran.
describe("what Open plans may say before it reads anything", () => {
  it("claims no absence", () => {
    const line = `${OUT_OPEN_PLANS_PLACEHOLDER_LINE} ${OUT_OPEN_PLANS_WAY_LABEL}`;
    expect(line).not.toMatch(/\bno\b/i);
    expect(line).not.toMatch(/\bnone\b/i);
    expect(line).not.toMatch(/\bnothing\b/i);
    expect(line).not.toMatch(/\byet\b/i);
    expect(line).not.toMatch(/\bempty\b/i);
  });

  it("still offers the way to make one", () => {
    expect(OUT_OPEN_PLANS_WAY_LABEL).toMatch(/plan/i);
  });

  it("keeps the house voice", () => {
    for (const line of [OUT_OPEN_PLANS_PLACEHOLDER_LINE, OUT_OPEN_PLANS_WAY_LABEL]) {
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/!/);
    }
  });
});

describe("which kinds reach the Out tab", () => {
  // Stated as one exclusion, so a kind added to the shared What's-On taxonomy
  // later reaches this page instead of being dropped by an allow-list nobody
  // widened.
  it("takes every What's-On kind except deals", () => {
    expect([...OUT_LISTING_KINDS].sort()).toEqual(
      WHATS_ON_KINDS.filter((kind) => kind !== "deal").sort(),
    );
    expect(OUT_LISTING_KINDS).not.toContain("deal");
    expect(OUT_LISTING_KINDS.length).toBe(WHATS_ON_KINDS.length - 1);
  });
});
