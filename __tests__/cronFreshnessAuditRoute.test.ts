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

  it("audits the registry and returns its findings without throwing", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.stale)).toBe(true);
    expect(Array.isArray(body.unresolved)).toBe(true);
    expect(typeof body.counts).toBe("object");
  });

  it("reports stale and unresolved as two separate findings", async () => {
    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    // A stale feed has a measured age; an unresolved one has none. Merging them
    // is what let eleven unreadable feeds bury two genuinely stale ones.
    for (const notice of body.stale) {
      expect(notice.status).toBe("stale");
      expect(typeof notice.ageHours).toBe("number");
    }
    for (const notice of body.unresolved) {
      expect(notice.status).toBe("unknown");
      expect(notice.ageHours).toBeNull();
    }
    const ids = [...body.stale, ...body.unresolved].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a genuine age for every registered feed when the artifacts are present", async () => {
    // The whole cause of the daily flood: the audit ran somewhere its artifacts
    // were not. With them present it must be able to age every one, so any
    // "unknown" left here is a real defect and not the audit's blind spot.
    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();
    expect(body.unresolved).toEqual([]);
    expect(body.counts.unknown ?? 0).toBe(0);
  });

  it("escalates a budget breach to a loud error-level [ALERT], not an advisory warn", async () => {
    // The committed registry has feeds past budget today, so the audit breaches.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));
    const body = await res.json();

    expect(body.breach).toBe(true);
    // Loud: error-level, distinct alert marker for log-based alerting.
    expect(errorSpy).toHaveBeenCalled();
    const alerted = errorSpy.mock.calls.some(([first]) =>
      typeof first === "string" && first.includes("[freshness-audit][ALERT]"),
    );
    expect(alerted).toBe(true);
    // The breach path no longer hides behind an advisory warn.
    const warnedBreach = warnSpy.mock.calls.some(([first]) =>
      typeof first === "string" && first.includes("breaching"),
    );
    expect(warnedBreach).toBe(false);
  });
});
