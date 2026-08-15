import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: loadWhatsOn is mocked (no CityMCP network); the freshness stamp lands
// in the process-memory feed-freshness store (no Supabase env).

const loadWhatsOnMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/whatsOnStore", () => ({ loadWhatsOn: loadWhatsOnMock }));

import { GET } from "@/app/api/cron/refresh-whats-on/route";
import {
  memoryFeedFreshnessStore,
  __resetFeedFreshnessStore,
} from "@/lib/feedFreshnessStore";
import { WHATS_ON_FEED_KEY } from "@/lib/freshnessStoreOverlay";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-whats-on", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetFeedFreshnessStore();
  vi.stubEnv("CRON_SECRET", "test-secret");
  loadWhatsOnMock.mockResolvedValue({
    rows: [{ id: "a" }, { id: "b" }],
    asOf: "2026-07-21T14:00:00.000Z",
  });
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

  it("reports a present provider key (loud-but-soft key awareness)", async () => {
    vi.stubEnv("TICKETMASTER_API_KEY", "tm-key");
    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    expect(body.eventProviderKeysPresent).toContain("TICKETMASTER_API_KEY");
  });

  it("does not stamp request time when the refresh fails", async () => {
    loadWhatsOnMock.mockRejectedValueOnce(new Error("provider unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();

    expect(body).toMatchObject({ ok: false, status: "unresolved", observedAt: null, rowsServed: null });
    expect(await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY)).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
