import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: reads the real committed freshness registry from disk (like
// /api/freshness); no Supabase env → the store overlay is empty and every feed
// keeps its disk-derived stamp. Never 500s.

import { GET } from "@/app/api/cron/freshness-audit/route";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/freshness-audit", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/freshness-audit", () => {
  it("401s without the cron secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("audits the registry and returns stale feeds without throwing", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.stale)).toBe(true);
    expect(typeof body.counts).toBe("object");
    // Every entry it flagged carries a status the notifier reports.
    for (const notice of body.stale) {
      expect(["stale", "unknown"]).toContain(notice.status);
    }
  });
});
