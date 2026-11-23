import {
  OUT_LISTING_KINDS,
  filterOutListings,
  outWindowToApiDay,
  parseOutDayWindow,
} from "@/lib/outListings";
import { describe, expect, it } from "vitest";
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

  it("names tonight as today on the Out API", () => {
    expect(outWindowToApiDay("tonight")).toBe("today");
    expect(outWindowToApiDay("tomorrow")).toBe("tomorrow");
    expect(outWindowToApiDay("weekend")).toBe("weekend");
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
