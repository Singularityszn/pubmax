import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OCCUPANCY_RETAKE_WINDOW_MS } from "@/lib/occupancy";
import {
  __resetMemoryOccupancyReports,
  occupancyStore,
} from "@/lib/occupancyStore";

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetMemoryOccupancyReports();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("occupancyStore", () => {
  it("writes a signed-in crowd report and reads it as now", async () => {
    const stored = await occupancyStore().report({
      venueId: "venue-1",
      level: "some-seats",
      reporterUserId: "user-a",
    });
    expect(stored.level).toBe("some-seats");
    expect(stored.source).toBe("crowd");
    expect(stored.reporterUserId).toBe("user-a");

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.degraded).toBe(false);
    expect(reading.now).toBe("some-seats");
    expect(reading.ageMinutes).toBe(0);
    expect(reading.reportsLast90).toBe(1);
    expect(reading.state).toBe("fresh");
  });

  it("updates a re-tap inside 15 minutes instead of stacking", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + OCCUPANCY_RETAKE_WINDOW_MS - 1_000);
    const updated = await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    expect(updated.level).toBe("full");

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.reportsLast90).toBe(1);
    expect(reading.now).toBe("full");
  });

  it("keeps an older row once the retake window closes", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "empty",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + OCCUPANCY_RETAKE_WINDOW_MS + 1_000);
    await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.reportsLast90).toBe(2);
    expect(reading.now).toBe("full");
  });

  it("drops a reading past 90 minutes and still answers, never as a failed empty", async () => {
    await occupancyStore().report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });
    vi.setSystemTime(NOW + 91 * 60 * 1000);

    const reading = await occupancyStore().readNow("venue-1");
    expect(reading.degraded).toBe(false);
    expect(reading.now).toBeNull();
    expect(reading.state).toBe("stale");
    expect(reading.reportsLast90).toBe(0);
  });
});
