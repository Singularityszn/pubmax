import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsOnRefresh.server", () => ({
  refreshOfficialWhatsOnListings: vi.fn(),
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
import { refreshOfficialWhatsOnListings } from "@/lib/whatsOnRefresh.server";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-whats-on", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetFeedFreshnessStore();
  supabaseState.configured = false;
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.mocked(refreshOfficialWhatsOnListings).mockResolvedValue({
    ok: true,
    mode: "providers",
    written: 4,
    observedAt: "2026-08-24T05:30:00.000Z",
    providers: [{ name: "ticketmaster", configured: true, rows: 4 }],
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

  it("persists official-API rows and stamps freshness", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: "providers",
      written: 4,
      observedAt: "2026-08-24T05:30:00.000Z",
      stamped: true,
    });
    const stamp = await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY);
    expect(stamp?.observedAt).toBe("2026-08-24T05:30:00.000Z");
    expect(stamp?.rowsServed).toBe(4);
  });

  it("does not stamp when no provider is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(refreshOfficialWhatsOnListings).mockResolvedValueOnce({
      ok: false,
      mode: "no-providers",
      written: 0,
      observedAt: null,
      providers: [{ name: "ticketmaster", configured: false, rows: 0 }],
    });
    const res = await GET(req("Bearer test-secret"));
    expect(await res.json()).toMatchObject({
      ok: false,
      mode: "no-providers",
      stamped: false,
      observedAt: null,
    });
    expect(await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY)).toBeNull();
    warn.mockRestore();
  });

  it("does not stamp when the provider fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(refreshOfficialWhatsOnListings).mockResolvedValueOnce({
      ok: false,
      mode: "providers",
      written: 0,
      observedAt: null,
      providers: [{ name: "ticketmaster", configured: true, rows: 0, error: "500" }],
    });
    const res = await GET(req("Bearer test-secret"));
    expect(await res.json()).toMatchObject({ ok: false, stamped: false, observedAt: null });
    expect(await memoryFeedFreshnessStore.read(WHATS_ON_FEED_KEY)).toBeNull();
    warn.mockRestore();
  });
});
