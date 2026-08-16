import { describe, expect, it } from "vitest";

import { BUSYNESS_VALUES } from "@/lib/visitReports";
import {
  OCCUPANCY_FRESH_WINDOW_MS,
  OCCUPANCY_LEVELS,
  OCCUPANCY_LEVEL_LABELS,
  OCCUPANCY_RETAKE_WINDOW_MS,
  occupancyAgeLabel,
  occupancyAgeMinutes,
  occupancyFromBusyness,
  occupancyLevelFromSql,
  occupancyLevelToSql,
  occupancyNowFromReports,
  occupancyReadState,
  occupancyReadingLine,
  occupancyReceiptLine,
  occupancyToBusyness,
  parseOccupancyLevel,
} from "@/lib/occupancy";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

function report(
  level: (typeof OCCUPANCY_LEVELS)[number],
  reportedAtMs: number,
  reporterUserId = "user-a",
) {
  return {
    venueId: "venue-1",
    level,
    reportedAt: new Date(reportedAtMs).toISOString(),
    reporterUserId,
    source: "crowd" as const,
  };
}

describe("occupancy vocabulary", () => {
  it("holds the three R-011 buttons and maps them onto visit-report busyness", () => {
    expect(OCCUPANCY_LEVELS).toEqual(["empty", "some-seats", "full"]);
    expect(OCCUPANCY_LEVEL_LABELS.empty).toBe("Empty");
    expect(OCCUPANCY_LEVEL_LABELS["some-seats"]).toBe("Some seats");
    expect(OCCUPANCY_LEVEL_LABELS.full).toBe("Full");

    expect(occupancyToBusyness("empty")).toBe("quiet");
    expect(occupancyToBusyness("some-seats")).toBe("steady");
    expect(occupancyToBusyness("full")).toBe("rammed");
    expect(occupancyFromBusyness("quiet")).toBe("empty");
    expect(occupancyFromBusyness("steady")).toBe("some-seats");
    expect(occupancyFromBusyness("rammed")).toBe("full");
    expect(BUSYNESS_VALUES.map(occupancyFromBusyness)).toEqual([
      ...OCCUPANCY_LEVELS,
    ]);
    expect(occupancyLevelToSql("empty")).toBe("empty");
    expect(occupancyLevelToSql("some-seats")).toBe("some_seats");
    expect(occupancyLevelToSql("full")).toBe("full");
    expect(occupancyLevelFromSql("some_seats")).toBe("some-seats");
    expect(occupancyLevelFromSql("quiet")).toBe("empty");
  });

  it("reads both the occupancy words and the visit-report words as the same scale", () => {
    expect(parseOccupancyLevel("some_seats")).toBe("some-seats");
    expect(parseOccupancyLevel("Some seats")).toBe("some-seats");
    expect(parseOccupancyLevel("quiet")).toBe("empty");
    expect(parseOccupancyLevel("steady")).toBe("some-seats");
    expect(parseOccupancyLevel("rammed")).toBe("full");
    expect(parseOccupancyLevel("mustard")).toBeNull();
  });
});

describe("occupancy 90-minute now rule", () => {
  it("uses only reports inside 90 minutes and prints their age", () => {
    expect(OCCUPANCY_FRESH_WINDOW_MS).toBe(90 * 60 * 1000);
    expect(OCCUPANCY_RETAKE_WINDOW_MS).toBe(15 * 60 * 1000);

    const fresh = occupancyNowFromReports(
      [
        report("empty", NOW - 12 * 60 * 1000),
        report("full", NOW - 91 * 60 * 1000),
      ],
      NOW,
    );
    expect(fresh.now).toBe("empty");
    expect(fresh.ageMinutes).toBe(12);
    expect(fresh.reportsLast90).toBe(1);
    expect(fresh.degraded).toBe(false);
    expect(occupancyReadState(fresh)).toBe("fresh");
    expect(occupancyReadingLine(fresh)).toBe("Empty · 12 min ago");

    const stale = occupancyNowFromReports(
      [report("full", NOW - 91 * 60 * 1000)],
      NOW,
    );
    expect(stale.now).toBeNull();
    expect(stale.ageMinutes).toBeNull();
    expect(stale.reportsLast90).toBe(0);
    expect(occupancyReadState(stale)).toBe("stale");
    expect(occupancyReadingLine(stale)).toBe("No fresh reading");

    const none = occupancyNowFromReports([], NOW);
    expect(occupancyReadState(none)).toBe("none");
    expect(occupancyReadingLine(none)).toBe("No fresh reading");

    const failed = occupancyNowFromReports([], NOW, { degraded: true });
    expect(failed.degraded).toBe(true);
    expect(occupancyReadState(failed)).toBe("degraded");
    expect(occupancyReadingLine(failed)).not.toBe("No fresh reading");
  });

  it("ages a just-now tap and a one-minute tap in house voice", () => {
    expect(occupancyAgeMinutes(NOW, NOW)).toBe(0);
    expect(occupancyAgeLabel(0)).toBe("just now");
    expect(occupancyAgeLabel(1)).toBe("1 min ago");
    expect(occupancyAgeLabel(12)).toBe("12 min ago");
    expect(occupancyReceiptLine("some-seats", 0)).toBe(
      "Thanks - Some seats, just now",
    );
  });
});
