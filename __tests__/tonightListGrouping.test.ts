import { describe, expect, it } from "vitest";

import { groupTonightListings } from "@/lib/tonightListGrouping";
import { laneKindFacets } from "@/lib/whatsOnBadges";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { defined } from "@/__tests__/helpers/defined";

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
    expect(defined(grouped[0]).venueCount).toBe(3);
    expect(defined(grouped[0]).alternates).toHaveLength(2);
  });

  it("shows the nearest venue first and orders alternates nearest-first when location is known", () => {
    const far = makeRow({ placeName: "Far", lat: 51.5, lng: -0.05 });
    const near = makeRow({ placeName: "Near", lat: 51.5, lng: -0.129 });
    const mid = makeRow({ placeName: "Mid", lat: 51.5, lng: -0.1 });
    const grouped = groupTonightListings([far, near, mid], NEAR);
    expect(grouped).toHaveLength(1);
    expect(defined(grouped[0]).row.placeName).toBe("Near");
    expect(defined(grouped[0]).alternates.map((r) => r.placeName)).toEqual(["Mid", "Far"]);
  });

  it("keeps a family's members in input order when no location is known", () => {
    // Members of one family share a schedule by construction (the group key
    // carries it), so with no near point there is nothing left to sort them by.
    const first = makeRow({ placeName: "First" });
    const second = makeRow({ placeName: "Second" });
    const grouped = groupTonightListings([first, second], null);
    expect(grouped).toHaveLength(1);
    expect(defined(grouped[0]).row.placeName).toBe("First");
    expect(defined(grouped[0]).alternates.map((r) => r.placeName)).toEqual(["Second"]);
  });

  it("passes a lone listing through untouched (count 1, no alternates)", () => {
    const grouped = groupTonightListings([makeRow({ title: "Solo Quiz", kind: "quiz" })], null);
    expect(grouped).toHaveLength(1);
    expect(defined(grouped[0]).venueCount).toBe(1);
    expect(defined(grouped[0]).alternates).toEqual([]);
  });

  it("orders fully tied families by their stable group key, never by input order", () => {
    // No coordinates, one confidence, one source observation and one start, so
    // every earlier tie-break level is equal and the group key decides. The key
    // leads with the kind, so deal sorts before music sorts before quiz.
    const rows = [
      makeRow({ title: "Curry Club", placeName: "C1" }),
      makeRow({ title: "Quiz Night", kind: "quiz", placeName: "Q1" }),
      makeRow({ title: "Curry Club", placeName: "C2" }), // folds into the first family
      makeRow({ title: "Live Jazz", kind: "music", placeName: "J1" }),
    ];
    const grouped = groupTonightListings(rows, null);
    expect(grouped.map((g) => g.row.title)).toEqual(["Curry Club", "Live Jazz", "Quiz Night"]);
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
    expect(defined(grouped[0]).venueCount).toBe(60);
  });

  it("feeds GROUPED family counts to the kind-filter facets, not raw inventory", () => {
    // The mocked scene: 14 identical Curry Club deals + one quiz + one live-music.
    const deals = Array.from({ length: 14 }, (_, i) =>
      makeRow({ title: "Curry Club", placeName: `Curry ${i}` }),
    );
    const quiz = makeRow({ title: "Thursday Quiz", kind: "quiz", placeName: "The Sharp Wit" });
    const music = makeRow({ title: "Live Jazz", kind: "music", placeName: "The Blue Note" });

    const grouped = groupTonightListings([...deals, quiz, music], null);
    // 16 raw listings collapse to 3 family cards → the "All" chip reads 3.
    expect(grouped).toHaveLength(3);

    // The kind chips count families (Deal 1, Quiz 1, Live music 1), the count the
    // viewer sees, not the 14-deal raw inventory. Reuses the shared laneKindFacets
    // on the grouped display rows, exactly as TonightClient does.
    const byKind = Object.fromEntries(
      laneKindFacets(grouped.map((g) => g.row)).map((f) => [f.kind, f.count]),
    );
    expect(byKind).toEqual({ deal: 1, quiz: 1, music: 1 });
  });

  it("collapses only truly identical offers: case and punctuation are ignored", () => {
    const rows = [
      makeRow({ placeName: "A", title: "Curry Club" }),
      makeRow({ placeName: "B", title: "curry   club" }), // case + repeated whitespace
    ];
    const grouped = groupTonightListings(rows, null);
    expect(grouped).toHaveLength(1);
    expect(defined(grouped[0]).venueCount).toBe(2);
  });

  it("keeps distinct SOURCES apart (never collapses across publishers)", () => {
    const rows = [
      makeRow({ placeName: "A", source: { label: "Chain Co", url: "https://a.example" } }),
      makeRow({ placeName: "B", source: { label: "Rival Co", url: "https://b.example" } }),
    ];
    expect(groupTonightListings(rows, null)).toHaveLength(2);
  });

  it("keeps distinct SCHEDULES apart", () => {
    // Same title + source + kind, different start times: one syndicated name run at
    // two different times is two offers, not one.
    const rows = [
      makeRow({ placeName: "Early", startsAt: "2026-07-23T18:00:00+01:00" }),
      makeRow({ placeName: "Late", startsAt: "2026-07-23T21:00:00+01:00" }),
    ];
    expect(groupTonightListings(rows, null)).toHaveLength(2);
  });

  it("keeps different listed-time evidence separate", () => {
    const rows = [
      makeRow({
        placeName: "Early",
        startsAt: undefined,
        timeEvidence: "Doors 6pm",
        listedWindow: "tonight",
      }),
      makeRow({
        placeName: "Late",
        startsAt: undefined,
        timeEvidence: "Doors 9pm",
        listedWindow: "tonight",
      }),
    ];

    expect(groupTonightListings(rows, null)).toHaveLength(2);
  });

  it("still collapses a 60-pub syndicated chain (identical schedule) to one card", () => {
    const curry = Array.from({ length: 60 }, (_, i) => makeRow({ placeName: `Curry ${i}` }));
    const grouped = groupTonightListings(curry, null);
    expect(grouped).toHaveLength(1);
    expect(defined(grouped[0]).venueCount).toBe(60);
    expect(defined(grouped[0]).alternates).toHaveLength(59);
  });

  it("orders groups by distance FIRST — a nearer listed offer beats a farther confirmed one", () => {
    const nearListed = makeRow({ title: "Near Listed", placeName: "N", confidence: "listed", lat: 51.5, lng: -0.129 });
    const farConfirmed = makeRow({ title: "Far Confirmed", placeName: "F", confidence: "confirmed", lat: 51.5, lng: -0.05 });
    const grouped = groupTonightListings([farConfirmed, nearListed], NEAR);
    expect(grouped.map((g) => g.row.title)).toEqual(["Near Listed", "Far Confirmed"]);
  });

  it("breaks equal-distance ties by confidence, then source observation, then start", () => {
    // No coordinates anywhere → every group ties at Infinity distance, so the
    // remaining tie-break levels are exercised in isolation.
    const confirmed = makeRow({ title: "Confirmed", confidence: "confirmed", observedAt: "2026-07-23T05:00:00.000Z", startsAt: "2026-07-23T22:00:00+01:00" });
    const listedFresh = makeRow({ title: "Listed Fresh", confidence: "listed", observedAt: "2026-07-23T09:00:00.000Z", startsAt: "2026-07-23T18:00:00+01:00" });
    const listedStale = makeRow({ title: "Listed Stale", confidence: "listed", observedAt: "2026-07-23T04:00:00.000Z", startsAt: "2026-07-23T18:00:00+01:00" });
    const grouped = groupTonightListings([listedStale, listedFresh, confirmed], null);
    // Confidence wins first (confirmed), then among the listed pair the fresher
    // source observation wins, though its start is identical.
    expect(grouped.map((g) => g.row.title)).toEqual(["Confirmed", "Listed Fresh", "Listed Stale"]);
  });

  it("breaks a full tie by earliest start", () => {
    const late = makeRow({ title: "Late", startsAt: "2026-07-23T21:00:00+01:00", observedAt: "2026-07-23T06:00:00.000Z" });
    const early = makeRow({ title: "Early", startsAt: "2026-07-23T18:00:00+01:00", observedAt: "2026-07-23T06:00:00.000Z" });
    const grouped = groupTonightListings([late, early], null);
    expect(grouped.map((g) => g.row.title)).toEqual(["Early", "Late"]);
  });

  it("caps any one family at two of the first ten, defers the rest, and drops nothing", () => {
    // Family A: 5 distinct-schedule groups; Family B: 5 distinct-schedule groups;
    // plus 6 singleton families — enough variety for a real diversity cap.
    const mkFamily = (title: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        makeRow({ title, placeName: `${title} ${i}`, startsAt: `2026-07-23T${String(18 + i).padStart(2, "0")}:00:00+01:00` }),
      );
    const singles = Array.from({ length: 6 }, (_, i) => makeRow({ title: `Solo ${i}`, placeName: `Solo ${i}` }));
    const rows = [...mkFamily("Family A", 5), ...mkFamily("Family B", 5), ...singles];

    const grouped = groupTonightListings(rows, null);
    // 5 + 5 + 6 = 16 distinct groups; nothing is dropped.
    expect(grouped).toHaveLength(16);

    const firstTen = grouped.slice(0, 10);
    const familyCounts = new Map<string, number>();
    for (const g of firstTen) familyCounts.set(g.row.title, (familyCounts.get(g.row.title) ?? 0) + 1);
    for (const [, n] of familyCounts) expect(n).toBeLessThanOrEqual(2);
  });

  it("lists every alternate exactly once with the nearest venue as hero", () => {
    const far = makeRow({ placeName: "Far", lat: 51.5, lng: -0.05 });
    const near = makeRow({ placeName: "Near", lat: 51.5, lng: -0.129 });
    const mid = makeRow({ placeName: "Mid", lat: 51.5, lng: -0.1 });
    const [group] = groupTonightListings([far, near, mid], NEAR);
    expect(defined(group).row.placeName).toBe("Near");
    expect(defined(group).alternates.map((r) => r.placeName)).toEqual(["Mid", "Far"]);
    const all = [defined(group).row, ...defined(group).alternates].map((r) => r.placeName);
    expect(new Set(all).size).toBe(all.length); // no duplication
  });

  it("is deterministic: identical input yields identical exact order", () => {
    const rows = [
      makeRow({ title: "B", placeName: "b" }),
      makeRow({ title: "A", placeName: "a" }),
      makeRow({ title: "C", placeName: "c" }),
    ];
    const first = groupTonightListings(rows, null).map((g) => g.row.title);
    const second = groupTonightListings(rows, null).map((g) => g.row.title);
    expect(first).toEqual(second);
  });
});
