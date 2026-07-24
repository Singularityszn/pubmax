import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// House pattern (followingRoute / planIdempotencyRoutes): the route asserts
// server env at module load, and CI has no Supabase vars.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET } from "@/app/api/plans/anchor/route";

const FLAG = "PUBMAX_ANCHORED_GENERATION";

function get(query: Record<string, string>): Promise<Response> {
  const url = new URL("http://localhost/api/plans/anchor");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return GET(new Request(url, { method: "GET" }));
}

describe("GET /api/plans/anchor", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[FLAG];
  });
  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it("is dark while anchored generation is off", async () => {
    delete process.env[FLAG];
    const response = await get({ cityId: "london", venueId: "venue-x" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "PLAN_ANCHOR_DISABLED" });
  });

  describe("with the flag on", () => {
    beforeEach(() => { process.env[FLAG] = "1"; });

    it("rejects a missing Venue, bad city, and bad area", async () => {
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
});
