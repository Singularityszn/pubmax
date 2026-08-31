import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => {
    throw new Error("durable store should not run in this test");
  },
}));

const moderator = vi.hoisted(() => ({ allowed: true }));

vi.mock("@/lib/adminAuth", () => ({
  isModerator: () => moderator.allowed,
}));

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
}));

import {
  __resetAreaDemand,
  memoryAreaDemandStore,
} from "@/lib/areaDemandStore";

beforeEach(() => {
  moderator.allowed = true;
  __resetAreaDemand();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/area-demand", () => {
  it("requires the existing moderator session", async () => {
    moderator.allowed = false;
    const { GET } = await import("@/app/api/admin/area-demand/route");

    const response = await GET(
      new Request("http://localhost/api/admin/area-demand"),
    );

    expect(response.status).toBe(403);
  });

  it("returns bounded ranked demand without contact fields or viewer coordinates", async () => {
    await memoryAreaDemandStore.record({
      area: "Sheffield",
      matchedPatchId: null,
      source: "map-miss",
      email: "one@example.com",
    });
    await memoryAreaDemandStore.record({
      area: "sheffield",
      matchedPatchId: null,
      source: "near-empty",
      email: "two@example.com",
    });
    const read = vi.spyOn(memoryAreaDemandStore, "listSummary");
    const { GET } = await import("@/app/api/admin/area-demand/route");

    const response = await GET(
      new Request(
        "http://localhost/api/admin/area-demand?limit=999&sinceDays=9999",
      ),
    );
    const body = await response.json();
    const serialised = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(read).toHaveBeenCalledWith({ limit: 100, sinceDays: 365 });
    expect(body).toEqual({
      summary: [expect.objectContaining({ area: "sheffield", signalCount: 2 })],
      partial: false,
      sinceDays: 365,
      status: "ready",
    });
    expect(serialised).not.toMatch(/email|latitude|longitude|coordinates/iu);
    expect(serialised).not.toContain("example.com");
  });

  it("keeps a failed store read distinct from real zero demand", async () => {
    vi.spyOn(memoryAreaDemandStore, "listSummary").mockResolvedValueOnce({
      items: [],
      partial: false,
      status: "degraded",
    });
    const { GET } = await import("@/app/api/admin/area-demand/route");

    const response = await GET(
      new Request("http://localhost/api/admin/area-demand"),
    );

    expect(await response.json()).toEqual({
      summary: [],
      partial: false,
      sinceDays: 90,
      status: "degraded",
    });
  });
});
