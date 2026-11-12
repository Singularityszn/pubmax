import { describe, expect, it } from "vitest";

import {
  MAP_FIX_OUTCOME_MAX,
  mapFixOutcomesFrom,
  unseenMapFixCount,
} from "@/lib/mapFixOutcomes";

const NOW = Date.parse("2026-11-12T20:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

describe("mapFixOutcomesFrom", () => {
  it("tells the reporter only about an accepted pub and a fixed note", () => {
    const outcomes = mapFixOutcomesFrom(
      [
        { id: "s1", name: "The Missing Crown", status: "accepted", reviewedAt: daysAgo(1) },
        { id: "s2", name: "Declined Arms", status: "declined", reviewedAt: daysAgo(1) },
        { id: "s3", name: "Already Here", status: "duplicate", reviewedAt: daysAgo(1) },
        { id: "s4", name: "Still Waiting", status: "pending", reviewedAt: null },
      ],
      [
        { id: "c1", venueId: "venue-crown", status: "resolved", resolvedAt: daysAgo(2) },
        { id: "c2", venueId: "venue-crown", status: "dismissed", resolvedAt: daysAgo(2) },
        { id: "c3", venueId: "venue-crown", status: "open", resolvedAt: null },
      ],
      new Map([["venue-crown", "The Crown"]]),
      NOW,
    );

    expect(outcomes).toEqual([
      { id: "pub:s1", kind: "pub_added", pubName: "The Missing Crown", venueId: null, decidedAt: daysAgo(1) },
      { id: "fix:c1", kind: "fact_fixed", pubName: "The Crown", venueId: "venue-crown", decidedAt: daysAgo(2) },
    ]);
  });

  it("drops a decision older than the window, and one stamped in the future", () => {
    const outcomes = mapFixOutcomesFrom(
      [
        { id: "old", name: "Old News", status: "accepted", reviewedAt: daysAgo(31) },
        { id: "edge", name: "Edge", status: "accepted", reviewedAt: daysAgo(30) },
        { id: "ahead", name: "Ahead", status: "accepted", reviewedAt: new Date(NOW + DAY).toISOString() },
      ],
      [],
      new Map(),
      NOW,
    );
    expect(outcomes.map((outcome) => outcome.id)).toEqual(["pub:edge"]);
  });

  it("orders newest first across both kinds and caps the list", () => {
    const submissions = Array.from({ length: MAP_FIX_OUTCOME_MAX }, (_, index) => ({
      id: `s${index}`,
      name: `Pub ${index}`,
      status: "accepted",
      reviewedAt: daysAgo(index + 2),
    }));
    const outcomes = mapFixOutcomesFrom(
      submissions,
      [{ id: "newest", venueId: "venue-unknown", status: "resolved", resolvedAt: daysAgo(1) }],
      new Map(),
      NOW,
    );
    expect(outcomes).toHaveLength(MAP_FIX_OUTCOME_MAX);
    expect(outcomes[0]).toMatchObject({ id: "fix:newest", pubName: "" });
    expect(outcomes.at(-1)?.id).toBe(`pub:s${MAP_FIX_OUTCOME_MAX - 2}`);
  });
});

describe("unseenMapFixCount", () => {
  const outcomes = mapFixOutcomesFrom(
    [
      { id: "a", name: "A", status: "accepted", reviewedAt: daysAgo(3) },
      { id: "b", name: "B", status: "accepted", reviewedAt: daysAgo(1) },
    ],
    [],
    new Map(),
    NOW,
  );

  it("counts everything when the reporter has never looked", () => {
    expect(unseenMapFixCount(outcomes, null)).toBe(2);
  });

  it("counts only what landed after the last look", () => {
    expect(unseenMapFixCount(outcomes, Date.parse(daysAgo(2)))).toBe(1);
    expect(unseenMapFixCount(outcomes, Date.parse(daysAgo(1)))).toBe(0);
  });
});
