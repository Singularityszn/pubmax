import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the Round routes. Backend selection is the
// roundsStore() seam (Supabase when configured, memory otherwise). We pin the
// in-memory store deterministically by mocking isSupabaseConfigured() === false
// at the @/lib/supabase seam — NOT by stubbing NODE_ENV, which Vite bakes at
// transform time (a runtime stub is a silent no-op under a production build;
// see profileOwnershipRoute.test.ts / pintDrops.test.ts for the house pattern).
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () =>
    new Map([
      [
        "venue-1",
        {
          id: "venue-1",
          name: "The Ship",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
        },
      ],
      [
        "bar-1",
        {
          id: "bar-1",
          name: "The Cocktail Bar",
          borough: "London",
          lat: 51.5,
          lng: -0.1,
          kind: "bar",
        },
      ],
    ]),
}));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

// The store-outage (503) cases script a write failure at the store seam. Keep the
// real module (memory store, validation, __resetMemoryRounds); a per-test hook can
// override create()/join() to return the store-failure variant. When null (the
// default), each delegates to the real memory store so every other case is
// unchanged.
const { createOverride, joinOverride } = vi.hoisted(() => ({
  createOverride: { fn: null as null | ((...args: unknown[]) => Promise<unknown>) },
  joinOverride: { fn: null as null | ((...args: unknown[]) => Promise<unknown>) },
}));
vi.mock("@/lib/roundsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roundsStore")>();
  return {
    ...actual,
    roundsStore: () => {
      const store = actual.roundsStore();
      return {
        ...store,
        create: (...args: Parameters<typeof store.create>) =>
          createOverride.fn ? createOverride.fn(...args) : store.create(...args),
        join: (...args: Parameters<typeof store.join>) =>
          joinOverride.fn ? joinOverride.fn(...args) : store.join(...args),
      };
    },
  };
});

import { POST as CREATE } from "@/app/api/rounds/route";
import { GET, POST } from "@/app/api/rounds/[code]/route";
import { __resetMemoryRounds } from "@/lib/roundsStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";
import type { RoundState } from "@/lib/rounds";

const CREATE_URL = "http://localhost/api/rounds";

function create(body: unknown): Promise<Response> {
  return CREATE(new Request(CREATE_URL, { method: "POST", body: JSON.stringify(body) }));
}

function ctx(code: string) {
  return { params: Promise.resolve({ code }) };
}

function get(code: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/rounds/${code}`), ctx(code));
}

function action(code: string, body: unknown): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/rounds/${code}`, { method: "POST", body: JSON.stringify(body) }),
    ctx(code),
  );
}

async function newRound(handle = "ken"): Promise<RoundState> {
  const res = await create({ handle });
  return (await res.json()) as RoundState;
}

beforeEach(() => {
  __resetMemoryRounds();
  __resetMemoryProfiles();
  authState.userId = null;
  // Clear the shared in-memory rate-limit window so per-handle create/action
  // budgets don't leak across cases (the limiter keys on handle + hashed IP).
  __resetPintDrops();
  // Default: store methods delegate to the real memory store (see the mock above).
  createOverride.fn = null;
  joinOverride.fn = null;
});

describe("POST /api/rounds — create", () => {
  it("creates a Round with the creator as first member (201)", async () => {
    const res = await create({ handle: "ken", title: "Big night" });
    expect(res.status).toBe(201);
    const state = (await res.json()) as RoundState;
    expect(state.round.title).toBe("Big night");
    expect(state.members.map((m) => m.handle)).toEqual(["ken"]);
  });

  it("rejects a create with no handle (400)", async () => {
    const res = await create({ title: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body (400)", async () => {
    const res = await CREATE(new Request(CREATE_URL, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("503s when the durable store fails to write the Round (degraded dependency, not a bug)", async () => {
    // A store-write failure ("error") is a degraded dependency, so the route
    // must fail soft with 503 (the house contract every other write route uses
    // — see pint-drops) rather than 500, which reads as an application bug.
    createOverride.fn = async () => ({ ok: false, error: "error" as const });
    const res = await create({ handle: "ken", title: "Big night" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Could not start the Round." });
  });
});

describe("GET /api/rounds/[code]", () => {
  it("returns live state for a real code", async () => {
    const { round } = await newRound("ken");
    const res = await get(round.code);
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.round.code).toBe(round.code);
  });

  it("404s an invalid code without hitting the store", async () => {
    const res = await get("nope");
    expect(res.status).toBe(404);
  });

  it("404s an unknown but well-formed code", async () => {
    const res = await get("ZZZZZZ");
    expect(res.status).toBe(404);
  });

  it("rate-limits valid rounds reads per hashed client IP", async () => {
    const { round } = await newRound("ken");
    const responses: Response[] = [];
    for (let i = 0; i < 121; i++) {
      responses.push(
        await GET(
          new Request(`http://localhost/api/rounds/${round.code}`, {
            headers: { "x-forwarded-for": "198.51.100.30" },
          }),
          ctx(round.code),
        ),
      );
    }

    expect(responses.slice(0, 120).every((res) => res.status === 200)).toBe(true);
    expect(responses[120].status).toBe(429);
    expect(await responses[120].json()).toEqual({ error: "Too many requests, slow down." });
  });
});

describe("POST /api/rounds/[code] — actions", () => {
  it("join adds a member (200)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "join", handle: "ale" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("rejects an action with no handle (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "join" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown action (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, { action: "explode", handle: "ken" });
    expect(res.status).toBe(400);
  });

  it("addStop by a member appends the stop (200)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
      venueName: "Spoofed name",
    });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.stops).toHaveLength(1);
    expect(state.stops[0]?.venueName).toBe("The Ship");
  });

  it("rejects a non-pub Round stop (400)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "bar-1",
      venueName: "The Cocktail Bar",
    });
    expect(res.status).toBe(400);
  });

  it("addStop by a non-member is forbidden (403)", async () => {
    const { round } = await newRound("ken");
    const res = await action(round.code, {
      action: "addStop",
      handle: "stranger",
      venueId: "venue-1",
      venueName: "The Ship",
    });
    expect(res.status).toBe(403);
  });

  it("close by a non-creator is forbidden (403)", async () => {
    const { round } = await newRound("ken");
    await action(round.code, { action: "join", handle: "ale" });
    const res = await action(round.code, { action: "close", handle: "ale" });
    expect(res.status).toBe(403);
  });

  it("503s when a store write fails on an action (degraded dependency, not a bug)", async () => {
    const { round } = await newRound("ken");
    // Force the store's join() to report a write failure — the route must map the
    // "error" write-error to 503 (fail-soft), matching every other write route,
    // not 500. The 4xx action outcomes (403/404/409/400) are unchanged.
    joinOverride.fn = async () => ({ ok: false, error: "error" as const });
    const res = await action(round.code, { action: "join", handle: "ale" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Couldn't save that. Try again." });
  });

  it("close by the creator, then addStop is 409 (closed)", async () => {
    const { round } = await newRound("ken");
    const closeRes = await action(round.code, { action: "close", handle: "ken" });
    expect(closeRes.status).toBe(200);
    const res = await action(round.code, {
      action: "addStop",
      handle: "ken",
      venueId: "venue-1",
      venueName: "The Ship",
    });
    expect(res.status).toBe(409);
  });
});

describe("rounds auth ownership — linked handle wins over body handle", () => {
  it("joins as the auth-linked handle, ignoring a spoofed body handle", async () => {
    const { round } = await newRound("ken");
    await memoryProfileStore.linkUser("ale", "user-ale");
    authState.userId = "user-ale";

    const res = await action(round.code, { action: "join", handle: "mallory" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("keeps the anonymous demo path when auth is absent", async () => {
    const { round } = await newRound("ken");
    authState.userId = null;
    const res = await action(round.code, { action: "join", handle: "demo" });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.members.map((m) => m.handle).sort()).toEqual(["demo", "ken"]);
  });
});
