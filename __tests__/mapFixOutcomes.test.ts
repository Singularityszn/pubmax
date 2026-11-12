// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  markMapFixesSeen,
  readMapFixOutcomes,
  readMapFixSeenAt,
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
      { id: "pub:s1", kind: "pub_accepted", pubName: "The Missing Crown", venueId: null, decidedAt: daysAgo(1) },
      { id: "fix:c1", kind: "fact_fixed", pubName: "The Crown", venueId: "venue-crown", decidedAt: daysAgo(2) },
    ]);
  });

  it("retains old decisions and excludes future decisions", () => {
    const outcomes = mapFixOutcomesFrom(
      [
        { id: "old", name: "Old News", status: "accepted", reviewedAt: daysAgo(31) },
        { id: "edge", name: "Edge", status: "accepted", reviewedAt: daysAgo(30) },
        { id: "ahead", name: "Ahead", status: "accepted", reviewedAt: new Date(NOW + DAY).toISOString() },
      ],
      [{ id: "older-fix", venueId: "crown", status: "resolved", resolvedAt: daysAgo(60) }],
      new Map(),
      NOW,
    );
    expect(outcomes.map((outcome) => outcome.id)).toEqual(["pub:edge", "pub:old", "fix:older-fix"]);
  });

  it("retains every decision in newest-first order across both kinds", () => {
    const submissions = Array.from({ length: 101 }, (_, index) => ({
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
    expect(outcomes).toHaveLength(102);
    expect(outcomes[0]).toMatchObject({ id: "fix:newest", pubName: "" });
    expect(outcomes.at(-1)?.id).toBe("pub:s100");
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

describe("map fix acknowledgement", () => {
  beforeEach(() => localStorage.clear());

  it("leaves omitted outcomes unread after a degraded read recovers", () => {
    const older = { id: "fix:older", kind: "fact_fixed", pubName: "Crown", venueId: "crown", decidedAt: daysAgo(2) };
    const newer = { id: "pub:newer", kind: "pub_accepted", pubName: "Ship", venueId: null, decidedAt: daysAgo(1) };
    const partial = readMapFixOutcomes([newer], false);
    markMapFixesSeen("reporter", partial);
    expect(readMapFixSeenAt("reporter")).toBeNull();
    const recovered = readMapFixOutcomes([newer, older], true);
    expect(unseenMapFixCount(recovered.outcomes, readMapFixSeenAt("reporter"))).toBe(2);
    markMapFixesSeen("reporter", recovered);
    expect(unseenMapFixCount(recovered.outcomes, readMapFixSeenAt("reporter"))).toBe(0);
  });

  it("does not acknowledge an incomplete payload", () => {
    const result = readMapFixOutcomes([
      { id: "pub:new", kind: "pub_accepted", pubName: "Ship", venueId: null, decidedAt: daysAgo(1) },
      { id: "fix:bad" },
    ], true);
    markMapFixesSeen("reporter", result);
    expect(readMapFixSeenAt("reporter")).toBeNull();
  });
});
