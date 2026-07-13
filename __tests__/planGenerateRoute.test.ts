import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST } from "@/app/api/plans/generate/route";

describe("POST /api/plans/generate", () => {
  it("returns an explained three-stop suggestion without creating a Plan", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({ nightArea: "clapham", daypart: "after_work", groupSize: 4 });
    expect(body.stops).toHaveLength(3);
    expect(body.stops[0]).toMatchObject({ venueId: expect.any(String), venueName: expect.any(String), reason: expect.any(String) });
    expect(body.explanations).toEqual(expect.arrayContaining([expect.objectContaining({ field: "nightArea" })]));
    expect(body).not.toHaveProperty("planId");
  });

  it("requires a description or explicit Night Context", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
  });
});
