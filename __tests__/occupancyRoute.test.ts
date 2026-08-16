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
    const response = await POST(postRequest({ level: "full" }), params("venue-1"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("writes a crowd report and reads it back", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "some seats" }),
      params("venue-1"),
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
    await POST(postRequest({ level: "empty" }), params("venue-1"));
    const response = await POST(postRequest({ level: "full" }), params("venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: "full",
      reportsLast90: 1,
    });
  });

  it("rate-limits repeated posts from one account", async () => {
    authState.userId = "user-a";
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const response = await POST(postRequest({ level: "empty" }), params("venue-1"));
      if (response.status === 429) {
        limited += 1;
        expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});
