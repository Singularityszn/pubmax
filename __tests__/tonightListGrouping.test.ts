import { describe, expect, it } from "vitest";

import { groupTonightListings } from "@/lib/tonightListGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";

// A well-formed Tonight listing; override per case. Distinct ids so stable
// tiebreaks are observable. Same shape as dealsDigest.test's fixture.
let seq = 0;
function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    placeName: `The Test Arms ${seq}`,
    kind: "deal",
    startsAt: "2026-07-23T18:00:00+01:00",
    title: "Curry Club",
    source: { label: "Chain Co", url: "https://chain.example/deal" },
    observedAt: "2026-07-23T06:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

// A near point in central London; venues placed east of it so a larger lng is
// farther away, making "nearest" deterministic.
const NEAR = { lat: 51.5, lng: -0.13 };

describe("groupTonightListings", () => {
  it("collapses a chain-wide duplicate offer to one card carrying the real venue count", () => {
    const rows = [
      makeRow({ placeName: "Curry A" }),
      makeRow({ placeName: "Curry B" }),
      makeRow({ placeName: "Curry C" }),
    ];
    const grouped = groupTonightListings(rows, null);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].venueCount).toBe(3);
    expect(grouped[0].alternates).toHaveLength(2);
  });

  it("shows the nearest venue first and orders alternates nearest-first when location is known", () => {
    const far = makeRow({ placeName: "Far", lat: 51.5, lng: -0.05 });
    const near = makeRow({ placeName: "Near", lat: 51.5, lng: -0.129 });
    const mid = makeRow({ placeName: "Mid", lat: 51.5, lng: -0.1 });
    const grouped = groupTonightListings([far, near, mid], NEAR);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].row.placeName).toBe("Near");
    expect(grouped[0].alternates.map((r) => r.placeName)).toEqual(["Mid", "Far"]);
  });

  it("keeps a stable, input-driven order when no location is known", () => {
    const soon = makeRow({ placeName: "Soon", startsAt: "2026-07-23T18:00:00+01:00" });
    const later = makeRow({ placeName: "Later", startsAt: "2026-07-23T20:00:00+01:00" });
    // soonest wins the display slot; ties fall back to input order.
    const grouped = groupTonightListings([later, soon], null);
    expect(grouped[0].row.placeName).toBe("Soon");
    expect(grouped[0].alternates.map((r) => r.placeName)).toEqual(["Later"]);
  });

  it("passes a lone listing through untouched (count 1, no alternates)", () => {
    const grouped = groupTonightListings([makeRow({ title: "Solo Quiz", kind: "quiz" })], null);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].venueCount).toBe(1);
    expect(grouped[0].alternates).toEqual([]);
  });

  it("preserves the list's first-appearance order across distinct families", () => {
    const rows = [
      makeRow({ title: "Curry Club", placeName: "C1" }),
      makeRow({ title: "Quiz Night", kind: "quiz", placeName: "Q1" }),
      makeRow({ title: "Curry Club", placeName: "C2" }), // folds into the first family
      makeRow({ title: "Live Jazz", kind: "music", placeName: "J1" }),
    ];
    const grouped = groupTonightListings(rows, null);
    expect(grouped.map((g) => g.row.title)).toEqual(["Curry Club", "Quiz Night", "Live Jazz"]);
  });

  it("holds the plan cap: no offer family appears more than twice in the first ten rows", () => {
    // 60 identical Curry Clubs (the P0) plus nine distinct fillers.
    const curry = Array.from({ length: 60 }, (_, i) => makeRow({ title: "Curry Club", placeName: `Curry ${i}` }));
    const fillers = Array.from({ length: 9 }, (_, i) =>
      makeRow({ title: `Distinct ${i}`, placeName: `Filler ${i}` }),
    );
    const grouped = groupTonightListings([...curry, ...fillers], null);

    const firstTen = grouped.slice(0, 10);
    const counts = new Map<string, number>();
    for (const g of firstTen) {
      const family = `${g.row.kind}|${g.row.title}|${g.row.source.label}`;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    for (const [, n] of counts) expect(n).toBeLessThanOrEqual(2);
    // And in fact the 60 duplicates are a single card carrying all 60 venues.
    expect(grouped[0].venueCount).toBe(60);
  });
});
