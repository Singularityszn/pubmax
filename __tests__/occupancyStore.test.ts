import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OCCUPANCY_RETAKE_WINDOW_MS } from "@/lib/occupancy";
import {
  __resetMemoryOccupancyReports,
  memoryOccupancyStore,
  occupancyStore,
  supabaseOccupancyStore,
} from "@/lib/occupancyStore";

// The durable table is absent: exactly the window between a code deploy and
// migration 0107 being applied.
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.venue_occupancy_reports' in the schema cache",
    );
  },
}));

const NOW = Date.parse("2026-08-16T18:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetMemoryOccupancyReports();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.VERCEL_ENV;
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

describe("occupancy read before the durable table exists", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("answers degraded in deployed production, never as no reports", async () => {
    process.env.VERCEL_ENV = "production";

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.degraded).toBe(true);
    expect(reading.state).toBe("degraded");
    expect(reading.now).toBeNull();
  });

  it("keeps the memory backend outside a deployed production instance", async () => {
    process.env.VERCEL_ENV = "preview";
    await memoryOccupancyStore.report({
      venueId: "venue-1",
      level: "full",
      reporterUserId: "user-a",
    });

    const reading = await supabaseOccupancyStore.readNow("venue-1");

    expect(reading.degraded).toBe(false);
    expect(reading.state).toBe("fresh");
    expect(reading.now).toBe("full");
  });
});
