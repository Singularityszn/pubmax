import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// House pattern (followingRoute / planIdempotencyRoutes): the route asserts
// server env at module load, and CI has no Supabase vars.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET } from "@/app/api/plans/anchor/route";

function get(query: Record<string, string>): Promise<Response> {
  const url = new URL("http://localhost/api/plans/anchor");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return GET(new Request(url, { method: "GET" }));
}

describe("GET /api/plans/anchor", () => {
  it("resolves accepted Venue preflight by default without a rollout flag", async () => {
    const response = await get({ cityId: "london", venueId: "venue-x" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });

  it("rejects a missing Venue, bad city, and bad area by default", async () => {
    expect((await get({ cityId: "london" })).status).toBe(400);
    expect((await get({ cityId: "atlantis", venueId: "venue-x" })).status).toBe(400);
    expect((await get({ cityId: "london", venueId: "venue-x", areaKind: "night-patch", areaId: "nowhere" })).status).toBe(400);
  });

  it("returns a machine-readable conflict for an unknown Venue", async () => {
    const response = await get({ cityId: "london", venueId: "venue-does-not-exist-zzz" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "conflict", code: "ANCHOR_VENUE_INVALID" });
  });
});
