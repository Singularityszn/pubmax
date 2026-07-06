import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the Round routes. With Supabase env cleared the routes
// select the in-memory Round store, so every case is deterministic and touches no
// network.

import { POST as CREATE } from "@/app/api/rounds/route";
import { GET, POST } from "@/app/api/rounds/[code]/route";
import { __resetMemoryRounds } from "@/lib/roundsStore";
import { __resetPintDrops } from "@/lib/pintDrops";
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
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryRounds();
  // Clear the shared in-memory rate-limit window so per-handle create/action
  // budgets don't leak across cases (the limiter keys on handle + hashed IP).
  __resetPintDrops();
});

afterAll(() => {
  vi.unstubAllEnvs();
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
      venueName: "The Ship",
    });
    expect(res.status).toBe(200);
    const state = (await res.json()) as RoundState;
    expect(state.stops).toHaveLength(1);
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
