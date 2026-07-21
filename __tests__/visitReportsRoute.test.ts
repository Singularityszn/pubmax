import { beforeEach, describe, expect, it, vi } from "vitest";

// POST/GET /api/visit-reports — validation, the durable rate-limit boundary, the
// public report → hide flow, and the moderator gate. The @/lib/supabase seam is
// pinned so isSupabaseConfigured reads false: the in-memory limiter and the
// process-memory store back the route (the house pattern for keyless write-route
// tests), so the suite is hermetic with no network.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { GET, POST } from "@/app/api/visit-reports/route";
import { __resetVisitReports, memoryVisitReportStore } from "@/lib/visitReportsStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function post(body: unknown, ip = "203.0.113.9"): Request {
  return new Request("http://localhost/api/visit-reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(qs: string): Request {
  return new Request(`http://localhost/api/visit-reports${qs}`, { method: "GET" });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PUBMAX_SOCIAL_FREEZE;
  // Set an admin token so isModerator requires it (it defaults OPEN under
  // NODE_ENV=test when unset); the gate tests then send no token and get 403.
  process.env.ADMIN_TOKEN = "test-admin-secret";
  __resetVisitReports();
  __resetPintDrops();
});

describe("POST /api/visit-reports (create)", () => {
  it("creates a valid report (201) and stores it", async () => {
    const res = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "steady", wouldReturn: "yes" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { report: { id: string; handle: string } };
    expect(data.report.handle).toBe("sam");
    expect(await memoryVisitReportStore.listForVenue("venue-1")).toHaveLength(1);
  });

  it("400s a malformed body", async () => {
    expect((await POST(post("{oops"))).status).toBe(400);
  });

  it("400s a report with no signal", async () => {
    const res = await POST(post({ venueId: "venue-1", handle: "sam" }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_REPORT");
  });

  it("429s once the per-handle durable budget is exceeded", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 9; i += 1) {
      last = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "steady" }));
    }
    expect(last?.status).toBe(429);
    const data = (await last!.json()) as { code: string; retryable: boolean };
    expect(data.code).toBe("RATE_LIMITED");
    expect(data.retryable).toBe(true);
  });

  it("pauses creation under the social freeze (503)", async () => {
    process.env.PUBMAX_SOCIAL_FREEZE = "social";
    const res = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "steady" }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/visit-reports (report + moderation)", () => {
  it("hides a report only after two distinct actors flag it", async () => {
    const created = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "rammed" }));
    const { report } = (await created.json()) as { report: { id: string } };

    const first = await POST(post({ action: "report", id: report.id, actor: "actor-a" }));
    expect(first.status).toBe(200);
    // Still visible after one report.
    expect(await memoryVisitReportStore.listForVenue("venue-1")).toHaveLength(1);

    const second = await POST(post({ action: "report", id: report.id, actor: "actor-b" }));
    expect(second.status).toBe(200);
    // Two distinct actors → hidden from public reads, into the mod queue.
    expect(await memoryVisitReportStore.listForVenue("venue-1")).toHaveLength(0);
    expect(await memoryVisitReportStore.listForReview("hidden")).toHaveLength(1);
  });

  it("404s a report against an unknown id", async () => {
    const res = await POST(post({ action: "report", id: "nope", actor: "a" }));
    expect(res.status).toBe(404);
  });

  it("403s a moderator action without the admin token", async () => {
    const res = await POST(post({ action: "keep_hidden", id: "whatever" }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/visit-reports", () => {
  it("400s without a venueId", async () => {
    expect((await GET(get(""))).status).toBe(400);
  });

  it("returns the venue reports and an honest summary", async () => {
    // Omit visitedAt so it defaults to tonight's evening — clock-robust (never a
    // future date), and three distinct handles are three distinct rows.
    for (const [i, busyness] of ["steady", "steady", "rammed"].entries()) {
      await POST(post({ venueId: "venue-2", handle: `user${i}`, busyness }));
    }
    const res = await GET(get("?venueId=venue-2"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      reports: unknown[];
      summary: { total: number; shown: boolean; headline: string | null; lines: string[] };
    };
    expect(data.reports).toHaveLength(3);
    expect(data.summary.shown).toBe(true);
    expect(data.summary.headline).toBe("3 recent visit reports");
    // Plain lines, never a star score.
    expect(JSON.stringify(data.summary).toLowerCase()).not.toContain("star");
  });

  it("403s the moderator queue without the admin token", async () => {
    expect((await GET(get("?status=hidden"))).status).toBe(403);
  });
});
