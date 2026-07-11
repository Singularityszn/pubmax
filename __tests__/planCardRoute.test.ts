import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET } from "@/app/api/plan-card/route";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";

beforeEach(() => __resetMemoryPlans());

describe("GET /api/plan-card", () => {
  it("renders the public Plan through the shared OG image pipeline", async () => {
    const created = await memoryPlanStore.create({
      title: "Thursday, sorted",
      startTime: "2026-07-16T17:30:00.000Z",
      creatorName: "Karan",
      stops: [{ venueId: "venue-1", venueName: "The George" }],
    });
    if (!created.ok) throw new Error("fixture Plan was not created");

    const response = await GET(new Request(`http://localhost/api/plan-card?id=${created.plan.plan.id}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
  });

  it("404s rather than leaking whether a malformed capability resembles a Plan", async () => {
    const response = await GET(new Request("http://localhost/api/plan-card?id=not-a-plan"));
    expect(response.status).toBe(404);
  });
});
