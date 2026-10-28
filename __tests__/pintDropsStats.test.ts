import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stats route resolves boroughs from the server-only venue index. Stub it
// with a tiny fixture so the test never touches the bundled dataset on disk and
// the borough tally is deterministic. London-prefixed venue ids keep the drops
// on the default London city surface.
vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () =>
    new Map([
      ["venue-hack1", { id: "venue-hack1", name: "The Hackney", borough: "Hackney", lat: 51.5, lng: -0.05 }],
      ["venue-hack2", { id: "venue-hack2", name: "The Other Hackney", borough: "Hackney", lat: 51.5, lng: -0.05 }],
      ["venue-camd1", { id: "venue-camd1", name: "The Camden", borough: "Camden", lat: 51.53, lng: -0.14 }],
    ]),
}));

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  getSupabaseAdmin: () => ({
    auth: {
      getUser: async (token: string) => {
        if (token === "owner-token" || token === "other-token") {
          return { data: { user: { id: token === "owner-token" ? "stats-owner" : "other-owner" } }, error: null };
        }
        return { data: { user: null }, error: { status: 401, code: "bad_jwt" } };
      },
    },
  }),
}));

import { GET } from "@/app/api/pint-drops/stats/route";
import { __resetPintDrops, addPintDrop } from "@/lib/pintDrops";
import type { PintDrop } from "@/lib/pintDrops";

import { __resetMemoryProfiles, memoryProfileStore } from "@/lib/profileStore";

const BASE = "http://localhost/api/pint-drops/stats";

function statsFor(handle?: string, token?: string): Promise<Response> {
  const url = handle ? `${BASE}?handle=${encodeURIComponent(handle)}` : BASE;
  return GET(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
}

function drop(partial: Partial<PintDrop> & Pick<PintDrop, "venueId">): void {
  addPintDrop({
    id: crypto.randomUUID(),
    handle: "statman",
    drink: "pint",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    ...partial,
  });
}

beforeEach(() => {
  __resetPintDrops();
  __resetMemoryProfiles();
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  process.env.RATE_LIMIT_SALT = "test-salt";
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/pint-drops/stats", () => {
  it("includes anonymous prices only for the verified author", async () => {
    await memoryProfileStore.createOwned("statman", "stats-owner");
    drop({ venueId: "venue-hack1", visibility: "anonymous" });
    await memoryProfileStore.createOwned("otherhandle", "other-owner");
    for (const token of [undefined, "invalid-token", "other-token"]) {
      const response = await statsFor("statman", token);
      expect(response.status).toBe(200);
      expect((await response.json()).stats).toMatchObject({
        total: 0, pintsMapped: 0, byBorough: [],
        streak: { current: 0, longest: 0, activeDays: 0, lastDay: "" },
      });
    }
    const response = await statsFor("statman", "owner-token");
    expect(response.status).toBe(200);
    expect((await response.json()).stats).toMatchObject({
      total: 1, pintsMapped: 1, byBorough: [{ borough: "Hackney", count: 1 }],
      streak: { activeDays: 1 },
    });
  });
  it("400s (flat envelope) when no handle is supplied", async () => {
    const res = await statsFor();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "handle_required", retryable: false });
    expect(typeof body.error).toBe("string");
  });

  it("summarises a contributor's priced drops by borough", async () => {
    drop({ venueId: "venue-hack1", priceGbp: 4.5 });
    drop({ venueId: "venue-hack2", priceGbp: 5 });
    drop({ venueId: "venue-camd1", priceGbp: 6 });
    // A note-only anecdote — counts toward the streak, not the "pints mapped".
    drop({ venueId: "venue-camd1", priceGbp: null, provenance: "anecdote", passedDownNote: "my old local" });

    const res = await statsFor("statman");
    expect(res.status).toBe(200);
    const { stats } = await res.json();

    expect(stats.handle).toBe("statman");
    expect(stats.pintsMapped).toBe(3);
    expect(stats.total).toBe(4);
    expect(stats.byBorough).toEqual([
      { borough: "Hackney", count: 2 },
      { borough: "Camden", count: 1 },
    ]);
    expect(stats.streak.current).toBeGreaterThanOrEqual(1);
  });

  it("returns an empty summary for a handle with no drops", async () => {
    const res = await statsFor("nobody");
    expect(res.status).toBe(200);
    const { stats } = await res.json();
    expect(stats.pintsMapped).toBe(0);
    expect(stats.byBorough).toEqual([]);
    expect(stats.streak.current).toBe(0);
  });
});
