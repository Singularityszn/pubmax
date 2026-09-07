import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetFeedFreshnessStore,
  feedFreshnessStore,
  memoryFeedFreshnessStore,
  supabaseFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";
import {
  __resetMemoryOccupancyReports,
  memoryOccupancyStore,
  occupancyStore,
  supabaseOccupancyStore,
} from "@/lib/occupancyStore";

// #727's feed-freshness/occupancy maintenance pair, discussed after #1158.
// This matrix records current policy. It does not approve the other six adopters.
// Only the transport is mocked. Both adapters and the production guard run unchanged.
const transport = vi.hoisted(() => ({
  configured: false,
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => transport.configured,
  requireSupabaseAdmin: () => ({ from: transport.from, rpc: transport.rpc }),
}));

type Reply = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
// One response per query, with no emulation of SQL, fallback or domain policy.
function reply(data: unknown, error: Reply["error"] = null) {
  const result: Reply = { data, error };
  const response = Promise.resolve(result);
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    then: response.then.bind(response),
  };
  transport.from.mockReturnValueOnce(query);
  return query;
}

const NOW = Date.parse("2026-09-07T18:00:00.000Z");
const observedAt = new Date(NOW).toISOString();
const feed = { feed: "pilot-feed", observedAt, rowsServed: 3, note: "refresh" };
const feedRow = {
  feed: feed.feed,
  observed_at: observedAt,
  rows_served: 3,
  note: "refresh",
};
const reportInput = {
  venueId: "pilot-venue",
  reporterUserId: "pilot-account",
  level: "some-seats" as const,
  now: NOW,
};
const occupancyRow = {
  id: "durable-report",
  venue_id: reportInput.venueId,
  reporter_user_id: reportInput.reporterUserId,
  level: "some_seats",
  reported_at: observedAt,
  source: "crowd",
  hidden_at: null,
  report_count: 0,
};
const missing = (table: string) => ({
  code: "42P01",
  message: `Could not find the table 'public.${table}' in the schema cache`,
});
const denied = { code: "42501", message: "permission denied" };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("NEXT_PHASE", "");
  transport.configured = false;
  transport.from.mockReset();
  transport.rpc.mockReset();
  // Unexpected transport calls must fail, not silently resemble an empty table.
  transport.from.mockImplementation(() => {
    throw new Error("Unexpected query");
  });
  transport.rpc.mockImplementation(() => {
    throw new Error("Unexpected RPC");
  });
  __resetFeedFreshnessStore();
  __resetMemoryOccupancyReports();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the two store pilots: configured and keyless contracts", () => {
  it("selects each existing adapter and refuses unconfigured production", () => {
    expect(feedFreshnessStore()).toBe(memoryFeedFreshnessStore);
    expect(occupancyStore()).toBe(memoryOccupancyStore);
    transport.configured = true;
    expect(feedFreshnessStore()).toBe(supabaseFeedFreshnessStore);
    expect(occupancyStore()).toBe(supabaseOccupancyStore);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(feedFreshnessStore()).toBe(supabaseFeedFreshnessStore);
    expect(occupancyStore()).toBe(supabaseOccupancyStore);
    transport.configured = false;
    expect(() => feedFreshnessStore()).toThrow("durable store required");
    expect(() => occupancyStore()).toThrow("durable store required");
    expect(transport.from).not.toHaveBeenCalled();
  });

  it("writes and reads the same feed stamp through both adapters", async () => {
    expect(await feedFreshnessStore().read(feed.feed)).toBeNull();
    expect(await feedFreshnessStore().stamp(feed)).toEqual({
      status: "stamped",
    });
    const expected = await feedFreshnessStore().read(feed.feed);
    transport.configured = true;
    const write = reply(null);
    expect(await feedFreshnessStore().stamp(feed)).toEqual({
      status: "stamped",
    });
    expect(write.upsert).toHaveBeenCalledWith(feedRow, { onConflict: "feed" });
    const read = reply(feedRow);
    expect(await feedFreshnessStore().read(feed.feed)).toEqual(expected);
    expect(read.eq).toHaveBeenCalledWith("feed", feed.feed);
    expect(transport.from.mock.calls).toEqual([
      ["feed_freshness"],
      ["feed_freshness"],
    ]);
    reply(null);
    expect(await feedFreshnessStore().read("absent")).toBeNull();
  });

  it("writes and reads the same occupancy facts through both adapters", async () => {
    expect(
      await occupancyStore().readNow(reportInput.venueId, NOW),
    ).toMatchObject({ degraded: false, now: null });
    await occupancyStore().report(reportInput);
    const { id: memoryId, ...expected } = await occupancyStore().readNow(
      reportInput.venueId,
      NOW,
    );
    expect(memoryId).toBeTruthy();
    transport.configured = true;
    const lookup = reply([]);
    const write = reply([occupancyRow]);
    const stored = await occupancyStore().report(reportInput);
    expect(stored).toMatchObject({
      id: occupancyRow.id,
      level: reportInput.level,
      reporterUserId: reportInput.reporterUserId,
    });
    expect(lookup.eq.mock.calls).toEqual([
      ["venue_id", reportInput.venueId],
      ["reporter_user_id", reportInput.reporterUserId],
    ]);
    expect(lookup.is).toHaveBeenCalledWith("hidden_at", null);
    expect(write.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_id: reportInput.venueId,
        reporter_user_id: reportInput.reporterUserId,
        level: "some_seats",
        reported_at: observedAt,
        source: "crowd",
      }),
    );
    const read = reply([occupancyRow]);
    const { id, ...actual } = await occupancyStore().readNow(
      reportInput.venueId,
      NOW,
    );
    expect(id).toBe(occupancyRow.id);
    expect(actual).toEqual(expected);
    expect(read.is).toHaveBeenCalledWith("hidden_at", null);
    expect(transport.from.mock.calls).toEqual(
      Array.from({ length: 3 }, () => ["venue_occupancy_reports"]),
    );
  });

  it("updates a configured occupancy retake and uses the moderation RPC", async () => {
    transport.configured = true;
    reply([occupancyRow]);
    const update = reply([{ ...occupancyRow, level: "full" }]);
    expect(
      await occupancyStore().report({ ...reportInput, level: "full" }),
    ).toMatchObject({ id: occupancyRow.id, level: "full" });
    expect(update.update).toHaveBeenCalledWith({
      level: "full",
      reported_at: observedAt,
    });
    expect(update.eq).toHaveBeenCalledWith("id", occupancyRow.id);
    transport.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await occupancyStore().flag(occupancyRow.id, "wrong", "actor")).toBe(
      true,
    );
    expect(transport.rpc).toHaveBeenCalledWith("report_occupancy_report", {
      p_id: occupancyRow.id,
      p_reason: "wrong",
      p_actor_hash: "actor",
    });
    const moderate = reply([{ id: occupancyRow.id }]);
    expect(await occupancyStore().moderate(occupancyRow.id, false)).toBe(true);
    expect(moderate.update).toHaveBeenCalledWith({ hidden_at: null });
  });
});

describe("the two store pilots: schema and write failures", () => {
  it.each(["development", "preview"])(
    "retains the existing missing-schema fallback in %s",
    async (environment) => {
      vi.stubEnv("VERCEL_ENV", environment);
      // Preview also uses a production Node build.
      vi.stubEnv("NODE_ENV", "production");
      transport.configured = true;
      reply(null, missing("feed_freshness"));
      expect(await feedFreshnessStore().stamp(feed)).toEqual({
        status: "stamped",
      });
      reply(null, missing("feed_freshness"));
      expect(await feedFreshnessStore().read(feed.feed)).toEqual(feed);
      reply(null, missing("venue_occupancy_reports"));
      const stored = await occupancyStore().report(reportInput);
      reply(null, missing("venue_occupancy_reports"));
      expect(
        await occupancyStore().readNow(reportInput.venueId, NOW),
      ).toMatchObject({ id: stored.id, now: "some-seats", degraded: false });
    },
  );

  it("refuses production schema-miss writes without mutating either memory store", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    transport.configured = true;
    reply(null, missing("feed_freshness"));
    expect(await feedFreshnessStore().stamp(feed)).toEqual({
      status: "stamped",
      failed: true,
    });
    expect(await memoryFeedFreshnessStore.read(feed.feed)).toBeNull();
    reply(null, missing("venue_occupancy_reports"));
    await expect(occupancyStore().report(reportInput)).rejects.toThrow(
      "refusing process-memory write fallback",
    );
    expect(
      await memoryOccupancyStore.readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: null, degraded: false });
  });

  it("keeps the existing production read difference explicit", async () => {
    await memoryFeedFreshnessStore.stamp(feed);
    await memoryOccupancyStore.report(reportInput);
    vi.stubEnv("VERCEL_ENV", "production");
    transport.configured = true;
    reply(null, missing("feed_freshness"));
    // Feed metadata may use its held stamp. Occupancy must report a failed read.
    expect(await feedFreshnessStore().read(feed.feed)).toEqual(feed);
    reply(null, missing("venue_occupancy_reports"));
    expect(
      await occupancyStore().readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: null, degraded: true });
  });

  it.each(["development", "production"])(
    "does not disguise denied writes as schema fallback in %s",
    async (environment) => {
      vi.stubEnv("VERCEL_ENV", environment);
      transport.configured = true;
      reply(null, denied);
      expect(await feedFreshnessStore().stamp(feed)).toEqual({
        status: "stamped",
        failed: true,
      });
      reply([]);
      reply(null, denied);
      await expect(occupancyStore().report(reportInput)).rejects.toThrow(
        "permission denied",
      );
      expect(await memoryFeedFreshnessStore.read(feed.feed)).toBeNull();
      expect(
        await memoryOccupancyStore.readNow(reportInput.venueId, NOW),
      ).toMatchObject({ now: null });
      reply(null, denied);
      expect(await feedFreshnessStore().read(feed.feed)).toBeNull();
      reply(null, denied);
      expect(
        await occupancyStore().readNow(reportInput.venueId, NOW),
      ).toMatchObject({ degraded: true });
    },
  );

  it("refuses missing production moderation storage and preserves the memory report", async () => {
    const stored = await memoryOccupancyStore.report(reportInput);
    vi.stubEnv("VERCEL_ENV", "production");
    transport.configured = true;
    transport.rpc.mockResolvedValueOnce({
      data: null,
      error: missing("report_occupancy_report"),
    });
    await expect(
      occupancyStore().flag(stored.id, "wrong", "actor"),
    ).rejects.toThrow("refusing process-memory write fallback");
    reply(null, { code: "42703", message: "column hidden_at does not exist" });
    await expect(occupancyStore().moderate(stored.id, true)).rejects.toThrow(
      "refusing process-memory write fallback",
    );
    expect(stored.reportCount).toBe(0);
    expect(stored.hiddenAt).toBeNull();
  });
});

describe("the two store pilots: reset isolation", () => {
  it("resets each memory store without clearing its peer or issuing durable writes", async () => {
    await memoryFeedFreshnessStore.stamp(feed);
    await memoryOccupancyStore.report(reportInput);
    __resetFeedFreshnessStore();
    expect(await memoryFeedFreshnessStore.read(feed.feed)).toBeNull();
    expect(
      await memoryOccupancyStore.readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: "some-seats" });
    await memoryFeedFreshnessStore.stamp(feed);
    __resetMemoryOccupancyReports();
    expect(await memoryFeedFreshnessStore.read(feed.feed)).toEqual(feed);
    expect(
      await memoryOccupancyStore.readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: null });
    expect(transport.from).not.toHaveBeenCalled();
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it("resets the occupancy column fallback without changing the configured adapter", async () => {
    transport.configured = true;
    reply(null, { code: "42703", message: "column hidden_at does not exist" });
    const legacy = reply([occupancyRow]);
    expect(
      await occupancyStore().readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: "some-seats", degraded: false });
    expect(legacy.select).not.toHaveBeenCalledWith(
      expect.stringContaining("hidden_at"),
    );
    expect(legacy.is).not.toHaveBeenCalled();
    __resetMemoryOccupancyReports();
    expect(occupancyStore()).toBe(supabaseOccupancyStore);
    const restored = reply([occupancyRow]);
    expect(
      await occupancyStore().readNow(reportInput.venueId, NOW),
    ).toMatchObject({ now: "some-seats", degraded: false });
    expect(restored.select).toHaveBeenCalledWith(
      expect.stringContaining("hidden_at"),
    );
    expect(restored.is).toHaveBeenCalledWith("hidden_at", null);
  });
});
