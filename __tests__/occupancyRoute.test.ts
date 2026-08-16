import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

// One case simulates the city pack failing to load; every other case passes
// through to the real canonical lookup on disk, so an unknown id really is
// unknown.
const venueIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) => {
      const canonicalId =
        id === "legacy-occupancy-pub" ? "venue-xjf3n0" : id;
      return venueIndexState.unavailable
        ? { status: "unavailable" as const, canonicalId }
        : actual.lookupCanonicalVenue(canonicalId);
    },
  };
});

const storeState = vi.hoisted(() => ({ failRead: false }));
vi.mock("@/lib/occupancyStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/occupancyStore")>();
  return {
    ...actual,
    occupancyStore: () => {
      const store = actual.occupancyStore();
      return {
        ...store,
        async readNow(venueId: string, now?: number) {
          if (storeState.failRead) throw new Error("lookup failed");
          return store.readNow(venueId, now);
        },
      };
    },
  };
});

import { GET, POST } from "@/app/api/venues/[id]/occupancy/route";
import { __resetMemoryOccupancyReports } from "@/lib/occupancyStore";
import { __resetPintDrops } from "@/lib/pintDrops";

const VENUE = "venue-xjf3n0";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/venues/venue-1/occupancy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.9",
    },
    body: JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request("http://localhost/api/venues/venue-1/occupancy");
}

beforeEach(() => {
  authState.userId = null;
  storeState.failRead = false;
  venueIndexState.unavailable = false;
  __resetMemoryOccupancyReports();
  __resetPintDrops();
});

describe("GET /api/venues/[id]/occupancy", () => {
  it("answers an empty ready read, never a missing city", async () => {
    const response = await GET(getRequest(), params("venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: null,
      ageMinutes: null,
      reportsLast90: 0,
      degraded: false,
      state: "none",
    });
  });

  it("marks a failed read degraded rather than empty", async () => {
    storeState.failRead = true;
    const response = await GET(getRequest(), params("venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: null,
      degraded: true,
      state: "degraded",
    });
  });
});

describe("POST /api/venues/[id]/occupancy", () => {
  it("requires a signed-in account", async () => {
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("writes a crowd report and reads it back", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "some seats" }),
      params(VENUE),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: "some-seats",
      ageMinutes: 0,
      reportsLast90: 1,
      degraded: false,
      state: "fresh",
      level: "some-seats",
    });
  });

  it("updates a re-tap by the same account", async () => {
    authState.userId = "user-a";
    await POST(postRequest({ level: "empty" }), params(VENUE));
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: "full",
      reportsLast90: 1,
    });
  });

  it("refuses a venue the index does not hold", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "full" }),
      params("totally-fake-venue-xyz"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Pick a venue from the map.",
      code: "INVALID_REQUEST",
    });

    const read = await GET(getRequest(), params("totally-fake-venue-xyz"));
    expect(await read.json()).toMatchObject({ now: null, state: "none" });
  });

  it("stores a report under the canonical id when an alias was tapped", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "full" }),
      params("legacy-occupancy-pub"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ now: "full" });

    const canonical = await GET(getRequest(), params(VENUE));
    expect(await canonical.json()).toMatchObject({
      now: "full",
      reportsLast90: 1,
    });
  });

  it("answers a retryable 503 when the venue list cannot be read", async () => {
    authState.userId = "user-a";
    venueIndexState.unavailable = true;
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("rate-limits repeated posts from one account", async () => {
    authState.userId = "user-a";
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const response = await POST(postRequest({ level: "empty" }), params(VENUE));
      if (response.status === 429) {
        limited += 1;
        expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});
