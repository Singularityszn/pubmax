import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: loadWhatsOn is mocked (no CityMCP network); the freshness stamp lands
// in the process-memory feed-freshness store (no Supabase env).

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async () => ({
    rows: [{ id: "a" }, { id: "b" }],
    asOf: "2026-07-21T14:00:00.000Z",
    revalidation: { status: "measured" },
    readStatus: "ready",
  })),
}));

const supabaseState = vi.hoisted(() => ({ configured: false }));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => supabaseState.configured,
  requireSupabaseAdmin: () => {
    throw new Error(
      "Could not find the table 'public.feed_freshness' in the schema cache",
    );
  },
}));

import { GET } from "@/app/api/cron/refresh-whats-on/route";
import {
  memoryFeedFreshnessStore,
  __resetFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";
import { WHATS_ON_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { loadWhatsOn } from "@/lib/whatsOnStore";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-whats-on", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetFeedFreshnessStore();
  supabaseState.configured = false;
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/refresh-whats-on", () => {
  it("401s without the cron secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("revalidates the tonight window and stamps freshness (slim mode)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, mode: "slim", rowsServed: 2, observedAt: "2026-07-21T14:00:00.000Z" });
    // No keys set → both key sets empty, and the missing-key skip is logged loud.
    expect(body.ingestKeysPresent).toEqual([]);
    expect(body.eventProviderKeysPresent).toEqual([]);
    expect(warn).toHaveBeenCalled();
    // The freshness stamp is durable in the (memory) store.
    const stamp = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);
    expect(stamp?.observedAt).toBe("2026-07-21T14:00:00.000Z");
    expect(stamp?.rowsServed).toBe(2);
    warn.mockRestore();
  });

  it("does not claim a degraded freshness write landed", async () => {
    const stamp = vi
      .spyOn(memoryFeedFreshnessStore, "stamp")
      .mockResolvedValueOnce({ status: "stamped", failed: true });

    const response = await GET(req("Bearer test-secret"));

    expect(await response.json()).toMatchObject({
      ok: true,
      stamped: false,
      stampDegraded: true,
    });
    expect(stamp).toHaveBeenCalledTimes(1);
    stamp.mockRestore();
  });

  it("reports a present provider key (loud-but-soft key awareness)", async () => {
    vi.stubEnv("TICKETMASTER_API_KEY", "tm-key");
    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    expect(body.eventProviderKeysPresent).toContain("TICKETMASTER_API_KEY");
  });

  // A revalidation that FAILED is not an observation. Stamping the request
  // instant made the freshness spine read this feed as just-checked for its
  // whole 48-hour budget, hiding the outage it exists to report.
  it("does NOT advance observedAt when the revalidation throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // A good run first, so there is a previous stamp to protect.
    await GET(req("Bearer test-secret"));
    const before = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);
    expect(before?.observedAt).toBe("2026-07-21T14:00:00.000Z");

    vi.mocked(loadWhatsOn).mockRejectedValueOnce(new Error("baseline row is malformed"));
    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, stamped: false, observedAt: null, rowsServed: 0 });
    expect(body.error).toContain("malformed");

    const after = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);
    expect(after?.observedAt).toBe("2026-07-21T14:00:00.000Z");
    expect(error).toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("does NOT stamp a fail-soft answer with only servedAt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(req("Bearer test-secret"));
    const before = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);

    vi.mocked(loadWhatsOn).mockResolvedValueOnce({
      rows: [],
      servedAt: "2026-07-21T15:00:00.000Z",
      sourceObservedAt: null,
      sourceFreshnessKind: "unknown",
      kindObservedAt: {},
      localityBasis: "london-default",
      asOf: null,
      revalidation: { status: "measured" },
      readStatus: "degraded",
    });
    const res = await GET(req("Bearer test-secret"));

    expect(await res.json()).toMatchObject({
      ok: false,
      stamped: false,
      observedAt: null,
      rowsServed: 0,
    });
    const after = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);
    expect(after).toEqual(before);

    warn.mockRestore();
  });

  it("does NOT stamp baseline freshness after a swallowed provider failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await GET(req("Bearer test-secret"));
    const before = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);

    vi.mocked(loadWhatsOn).mockResolvedValueOnce({
      rows: [{ id: "baseline" }] as unknown as Awaited<
        ReturnType<typeof loadWhatsOn>
      >["rows"],
      servedAt: "2026-07-21T15:00:00.000Z",
      sourceObservedAt: "2026-07-21T14:30:00.000Z",
      sourceFreshnessKind: "dataset-generated",
      kindObservedAt: {},
      localityBasis: "london-default",
      asOf: "2026-07-21T14:30:00.000Z",
      readStatus: "degraded",
      revalidation: {
        status: "unmeasured",
        reason: "live-provider-failed",
      },
    });
    const response = await GET(req("Bearer test-secret"));

    expect(await response.json()).toMatchObject({
      ok: false,
      stamped: false,
      observedAt: null,
      rowsServed: 0,
    });
    expect(await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY)).toEqual(before);
    expect(error).toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("reports a failed stamp when production schema is missing", async () => {
    supabaseState.configured = true;
    vi.stubEnv("VERCEL_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(req("Bearer test-secret"));

    expect(await response.json()).toMatchObject({
      ok: true,
      stamped: false,
      stampDegraded: true,
    });
    expect(await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY)).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
