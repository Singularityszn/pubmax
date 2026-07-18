import { describe, it, expect } from "vitest";
import {
  isValidWhatsOnRow,
  isWhatsOnKind,
  parseWhatsOnRows,
  dedupeKey,
  dedupeRows,
  londonServiceDayBounds,
  isOnTonight,
  filterTonight,
  filterByKind,
  matchVenueId,
  normaliseEventTitle,
  normaliseSourceLabel,
  mapThingsToDoToRows,
  fetchRawThingsToDoStartsAt,
  THINGS_TO_DO_KIND_MAP,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import type { ThingsToDoResult, ThingsToDoOpportunity } from "@/lib/citymcp/client";

const NOW = Date.parse("2026-07-11T20:00:00.000Z");

function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "quiz-1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-11T19:30:00+01:00",
    title: "Pub quiz — Fridays 7:30pm",
    source: { label: "Question One", url: "https://questionone.com/venues/test-arms/" },
    observedAt: "2026-07-11T18:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("isWhatsOnKind", () => {
  it("recognises the 4 kinds and rejects others", () => {
    expect(isWhatsOnKind("sport")).toBe(true);
    expect(isWhatsOnKind("quiz")).toBe(true);
    expect(isWhatsOnKind("deal")).toBe(true);
    expect(isWhatsOnKind("music")).toBe(true);
    expect(isWhatsOnKind("gig")).toBe(false);
    expect(isWhatsOnKind(null)).toBe(false);
  });
});

describe("isValidWhatsOnRow", () => {
  it("accepts a well-formed row (and null optionals)", () => {
    expect(isValidWhatsOnRow(makeRow(), NOW)).toBe(true);
    expect(isValidWhatsOnRow({ ...makeRow(), venueId: null, lat: null, lng: null }, NOW)).toBe(true);
    expect(isValidWhatsOnRow(makeRow({ priceGbp: 0 }), NOW)).toBe(true);
  });

  it("rejects non-objects and missing required fields", () => {
    expect(isValidWhatsOnRow(null, NOW)).toBe(false);
    expect(isValidWhatsOnRow("nope", NOW)).toBe(false);
    expect(isValidWhatsOnRow({}, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ id: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ placeName: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ title: "" }), NOW)).toBe(false);
  });

  it("rejects a bad kind, confidence, or startsAt", () => {
    expect(isValidWhatsOnRow({ ...makeRow(), kind: "gig" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow({ ...makeRow(), confidence: "guessed" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ startsAt: "someday" }), NOW)).toBe(false);
  });

  it("requires provenance ({label, absolute-http url}); no licence field needed", () => {
    expect(isValidWhatsOnRow({ ...makeRow(), source: null }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "", url: "https://x.com" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "not-a-url" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "ftp://x.com" } }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ source: { label: "X", url: "https://x.com" } }), NOW)).toBe(true);
  });

  it("rejects a missing/invalid/future observedAt", () => {
    expect(isValidWhatsOnRow(makeRow({ observedAt: "" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ observedAt: "yesterday" }), NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ observedAt: "2026-07-11T20:00:01.000Z" }), NOW)).toBe(false);
  });

  it("rejects a negative price and bad optional coords", () => {
    expect(isValidWhatsOnRow(makeRow({ priceGbp: -1 }), NOW)).toBe(false);
    expect(isValidWhatsOnRow({ ...makeRow(), lat: "51.5" }, NOW)).toBe(false);
    expect(isValidWhatsOnRow(makeRow({ endsAt: "nope" }), NOW)).toBe(false);
  });
});

describe("parseWhatsOnRows + dedupe", () => {
  it("accepts a bare array and a { rows } envelope, dropping bad rows", () => {
    expect(parseWhatsOnRows([makeRow(), { junk: true }], NOW)).toHaveLength(1);
    expect(parseWhatsOnRows({ rows: [makeRow()] }, NOW)).toHaveLength(1);
    expect(parseWhatsOnRows(null, NOW)).toEqual([]);
    expect(parseWhatsOnRows(42, NOW)).toEqual([]);
  });

  it("dedupes by (place, kind, startsAt), keeping the freshest observedAt", () => {
    const parsed = parseWhatsOnRows(
      [
        makeRow({ id: "old", observedAt: "2026-07-10T00:00:00.000Z", title: "old" }),
        makeRow({ id: "new", observedAt: "2026-07-11T00:00:00.000Z", title: "new" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("new");
  });

  it("keys off venueId when present, else lowercased placeName", () => {
    expect(dedupeKey(makeRow({ venueId: "venue-abc" }))).toContain("venue-abc");
    expect(dedupeKey(makeRow())).toContain("the test arms");
  });

  it("treats different kinds at the same place/time as independent", () => {
    const parsed = dedupeRows([makeRow({ kind: "quiz" }), makeRow({ kind: "music", id: "m" })]);
    expect(parsed).toHaveLength(2);
  });
});

describe("London tonight windowing (04:00 service-day rollback)", () => {
  it("computes a [16:00, next-04:00) evening window in BST", () => {
    const { start, end } = londonServiceDayBounds(Date.parse("2026-07-11T20:00:00.000Z"));
    // BST (+01:00): 16:00 London = 15:00Z; next 04:00 London = 03:00Z next day.
    expect(start).toBe("2026-07-11T15:00:00.000Z");
    expect(end).toBe("2026-07-12T03:00:00.000Z");
  });

  it("rolls back to the previous evening before 04:00 London", () => {
    const { start, end } = londonServiceDayBounds(Date.parse("2026-07-12T01:30:00.000Z"));
    expect(start).toBe("2026-07-11T15:00:00.000Z");
    expect(end).toBe("2026-07-12T03:00:00.000Z");
  });

  it("isOnTonight / filterTonight select rows inside the window", () => {
    const now = Date.parse("2026-07-11T20:00:00.000Z");
    const inside = makeRow({ id: "in", startsAt: "2026-07-11T19:30:00+01:00" });
    const before = makeRow({ id: "before", startsAt: "2026-07-11T10:00:00+01:00" });
    const after = makeRow({ id: "after", startsAt: "2026-07-12T09:00:00+01:00" });
    expect(isOnTonight(inside, now)).toBe(true);
    expect(isOnTonight(before, now)).toBe(false);
    expect(isOnTonight(after, now)).toBe(false);
    expect(filterTonight([inside, before, after], now).map((r) => r.id)).toEqual(["in"]);
  });
});

describe("filterByKind + matchVenueId", () => {
  it("filters by kind", () => {
    const rows = [makeRow({ kind: "quiz" }), makeRow({ id: "d", kind: "deal" })];
    expect(filterByKind(rows, "deal").map((r) => r.id)).toEqual(["d"]);
  });

  it("resolves a venueId only when absent", () => {
    const resolver = (name: string) => (name === "The Test Arms" ? "venue-xyz" : undefined);
    expect(matchVenueId(makeRow(), resolver).venueId).toBe("venue-xyz");
    expect(matchVenueId(makeRow({ venueId: "already" }), resolver).venueId).toBe("already");
    expect(matchVenueId(makeRow({ placeName: "Unknown" }), resolver).venueId).toBeUndefined();
  });
});

describe("mapThingsToDoToRows", () => {
  const windowStart = "2026-07-11T15:00:00.000Z";

  function result(opps: ThingsToDoOpportunity[]): ThingsToDoResult {
    return { window: "tonight", opportunities: opps };
  }

  it("maps gig/nightlife to music and food_drink to deal", () => {
    expect(THINGS_TO_DO_KIND_MAP).toMatchObject({ gig: "music", nightlife: "music", food_drink: "deal" });
    const rows = mapThingsToDoToRows(
      result([
        {
          title: "Jazz night",
          kind: "gig",
          timeEvidence: "8pm",
          place: { name: "Blue Post", location: { lat: 51.52, lng: -0.08 } },
          source: { label: "Time Out", url: "https://timeout.com/x" },
        },
        {
          title: "£3 pints",
          kind: "food_drink",
          place: { name: "The Deal Arms" },
          source: { label: "Time Out", url: "https://timeout.com/y" },
        },
      ]),
      { now: NOW, windowStart },
    );
    expect(rows.map((r) => r.kind).sort()).toEqual(["deal", "music"]);
    const music = rows.find((r) => r.kind === "music")!;
    expect(music.confidence).toBe("listed");
    expect(music.startsAt).toBe(windowStart);
    expect(music.lat).toBe(51.52);
    expect(music.detail).toContain("Listed time: 8pm");
  });

  it("drops non-mapping kinds, missing place names, and non-http sources", () => {
    const rows = mapThingsToDoToRows(
      result([
        { title: "Exhibition", kind: "exhibition", place: { name: "Tate" }, source: { label: "T", url: "https://t.com" } },
        { title: "No place", kind: "gig", source: { label: "T", url: "https://t.com" } },
        { title: "No url", kind: "gig", place: { name: "X" }, source: { label: "T" } },
        { title: "Bad url", kind: "gig", place: { name: "X" }, source: { label: "T", url: "ftp://t.com" } },
      ]),
      { now: NOW, windowStart },
    );
    expect(rows).toHaveLength(0);
  });

  it("prefers a raw ISO start from startsAtByTitle when valid", () => {
    const rows = mapThingsToDoToRows(
      result([
        {
          title: "Timed gig",
          kind: "gig",
          place: { name: "Venue" },
          source: { label: "T", url: "https://t.com" },
        },
      ]),
      { now: NOW, windowStart, startsAtByTitle: new Map([["Timed gig", "2026-07-11T21:00:00+01:00"]]) },
    );
    expect(rows[0].startsAt).toBe("2026-07-11T21:00:00+01:00");
  });
});

describe("fetchRawThingsToDoStartsAt", () => {
  function sseFrame(payload: unknown): string {
    return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  it("returns a title-to-ISO map when upstream carries raw startsAt", async () => {
    const fetchImpl = (async () =>
      new Response(
        sseFrame({
          jsonrpc: "2.0",
          id: 1,
          result: {
            structuredContent: {
              opportunities: [
                { title: "A", startsAt: "2026-07-11T20:00:00+01:00" },
                { title: "B" },
                { title: "C", startsAt: "nope" },
              ],
            },
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const map = await fetchRawThingsToDoStartsAt({ window: "tonight", fetchImpl });
    expect(map.get("A")).toBe("2026-07-11T20:00:00+01:00");
    expect(map.has("B")).toBe(false);
    expect(map.has("C")).toBe(false);
  });
});

describe("normaliseEventTitle", () => {
  const EM = String.fromCharCode(0x2014); // em dash
  const EN = String.fromCharCode(0x2013); // en dash

  it("folds an em dash in an event title to a plain spaced hyphen", () => {
    expect(normaliseEventTitle(`Skehan's ${EM} Live Music`)).toBe(
      "Skehan's - Live Music",
    );
  });

  it("folds an en dash too, and normalises spacing around it", () => {
    expect(normaliseEventTitle(`Quiz${EN}Every Sunday`)).toBe("Quiz - Every Sunday");
    expect(normaliseEventTitle(`Deal   ${EM}   Tuesdays`)).toBe("Deal - Tuesdays");
  });

  it("leaves a plain-hyphen title untouched", () => {
    expect(normaliseEventTitle("Open mic - Thursdays")).toBe("Open mic - Thursdays");
  });

  it("no typographic dash survives a title through parseWhatsOnRows", () => {
    const rows = parseWhatsOnRows(
      [makeRow({ title: `Live Music ${EM} Fridays ${EN} 8pm` })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].title).toBe("Live Music - Fridays - 8pm");
  });

  it("no typographic dash survives a CityMCP row through mapThingsToDoToRows", () => {
    const result: ThingsToDoResult = {
      window: "tonight",
      opportunities: [
        {
          title: `Jazz ${EM} Late`,
          kind: "gig",
          place: { name: "The Blue Post", location: { lat: 51.5, lng: -0.1 } },
          source: { label: "Skiddle", url: "https://skiddle.com/e/1" },
        } as unknown as ThingsToDoOpportunity,
      ],
    };
    const rows = mapThingsToDoToRows(result, {
      now: NOW,
      windowStart: "2026-07-11T19:00:00+01:00",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].title).toBe("Jazz - Late");
  });
});

describe("normaliseSourceLabel", () => {
  const EM = String.fromCharCode(0x2014); // em dash
  const EN = String.fromCharCode(0x2013); // en dash

  it("folds a typographic dash in a source label to a plain spaced hyphen", () => {
    expect(normaliseSourceLabel(`Skehan's ${EM} Live Music`)).toBe("Skehan's - Live Music");
    expect(normaliseSourceLabel(`Skiddle ${EN} Gigs`)).toBe("Skiddle - Gigs");
  });

  it("leaves a plain source label untouched", () => {
    expect(normaliseSourceLabel("Question One")).toBe("Question One");
  });

  it("no typographic dash survives a source label through parseWhatsOnRows", () => {
    const rows = parseWhatsOnRows(
      [makeRow({ source: { label: `Skehan's ${EM} Live Music`, url: "https://skehans.com/e" } })],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source.label).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].source.label).toBe("Skehan's - Live Music");
  });

  it("no typographic dash survives a source label through mapThingsToDoToRows", () => {
    const result: ThingsToDoResult = {
      window: "tonight",
      opportunities: [
        {
          title: "Jazz Night",
          kind: "gig",
          place: { name: "The Blue Post", location: { lat: 51.5, lng: -0.1 } },
          source: { label: `Skehan's ${EM} Live Music`, url: "https://skiddle.com/e/1" },
        } as unknown as ThingsToDoOpportunity,
      ],
    };
    const rows = mapThingsToDoToRows(result, {
      now: NOW,
      windowStart: "2026-07-11T19:00:00+01:00",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source.label).not.toMatch(/[\u2013\u2014]/);
    expect(rows[0].source.label).toBe("Skehan's - Live Music");
  });
});
