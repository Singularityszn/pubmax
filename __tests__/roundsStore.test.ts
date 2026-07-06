import { beforeEach, describe, expect, it } from "vitest";

// Exercise the in-memory Round store directly — no live Supabase, no env keys. It
// is the backend the route uses when Supabase is unconfigured, and it enforces the
// SAME domain rules as the Supabase path (join idempotency, venue idempotency,
// closed-round guards, member-only add, creator-only close), so the guarantees
// here mirror production.
//
// FORCE the in-memory path: on Vercel vitest runs with the project's env set — if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the store would try the
// Supabase client (network) and cases would fail only in CI. Clearing them in
// beforeEach pins the store to memory everywhere; we also reset the shared memory
// map so cases can't leak Rounds into each other.
import {
  __resetMemoryRounds,
  memoryRoundsStore,
  roundsStore,
} from "@/lib/roundsStore";

const store = memoryRoundsStore;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryRounds();
});

async function makeRound(handle = "ken") {
  const res = await store.create({ title: "Big night", createdByHandle: handle });
  if (!res.ok) throw new Error("create failed in test setup");
  return res.state;
}

describe("roundsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(roundsStore()).toBe(memoryRoundsStore);
  });
});

describe("create", () => {
  it("mints a Round with the creator as its first member", async () => {
    const state = await makeRound("ken");
    expect(state.round.code).toHaveLength(6);
    expect(state.round.createdByHandle).toBe("ken");
    expect(state.round.closedAt).toBeNull();
    expect(state.members.map((m) => m.handle)).toEqual(["ken"]);
    expect(state.stops).toEqual([]);
  });

  it("rejects a Round with no creator handle", async () => {
    const res = await store.create({ title: "x", createdByHandle: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("mints distinct codes for distinct Rounds", async () => {
    const a = await makeRound("ken");
    const b = await makeRound("ale");
    expect(a.round.code).not.toBe(b.round.code);
  });
});

describe("getByCode", () => {
  it("resolves a Round by its code (any casing / spacing)", async () => {
    const { round } = await makeRound("ken");
    const found = await store.getByCode(`  ${round.code.toLowerCase()} `);
    expect(found?.round.id).toBe(round.id);
  });

  it("returns null for an unknown code", async () => {
    expect(await store.getByCode("ZZZZZZ")).toBeNull();
  });
});

describe("join", () => {
  it("adds a new member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("is idempotent — re-joining with the same handle does not duplicate", async () => {
    const { round } = await makeRound("ken");
    await store.join(round.code, "ale");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.members.filter((m) => m.handle === "ale")).toHaveLength(1);
    }
  });

  it("cannot join an unknown Round", async () => {
    const res = await store.join("ZZZZZZ", "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_found");
  });

  it("cannot join a closed Round", async () => {
    const { round } = await makeRound("ken");
    await store.close(round.code, "ken");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("closed");
  });
});

describe("addStop", () => {
  const STOP = { venueId: "venue-1", venueName: "The Ship" };

  it("appends a stop from a member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.stops).toHaveLength(1);
      expect(res.state.stops[0]).toMatchObject({
        venueId: "venue-1",
        venueName: "The Ship",
        addedByHandle: "ken",
      });
    }
  });

  it("carries a drop_ref when the stop built itself from a drop", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, {
      ...STOP,
      addedByHandle: "ken",
      dropRef: "drop-42",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.stops[0].dropRef).toBe("drop-42");
  });

  it("is idempotent on venue — the same pub is not a second stop", async () => {
    const { round } = await makeRound("ken");
    await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.stops).toHaveLength(1);
  });

  it("rejects a stop from a non-member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "stranger" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });

  it("cannot add a stop to a closed Round", async () => {
    const { round } = await makeRound("ken");
    await store.close(round.code, "ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("closed");
  });

  it("rejects an invalid stop payload", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { venueId: "", venueName: "", addedByHandle: "ken" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("preserves insert order across multiple pubs", async () => {
    const { round } = await makeRound("ken");
    await store.addStop(round.code, { venueId: "v1", venueName: "One", addedByHandle: "ken" });
    await store.addStop(round.code, { venueId: "v2", venueName: "Two", addedByHandle: "ken" });
    const state = await store.getByCode(round.code);
    expect(state?.stops.map((s) => s.venueId)).toEqual(["v1", "v2"]);
  });
});

describe("close", () => {
  it("only the creator can close", async () => {
    const { round } = await makeRound("ken");
    await store.join(round.code, "ale");
    const res = await store.close(round.code, "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });

  it("the creator closes the Round", async () => {
    const { round } = await makeRound("ken");
    const res = await store.close(round.code, "ken");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.round.closedAt).not.toBeNull();
  });

  it("is idempotent — closing a closed Round is fine", async () => {
    const { round } = await makeRound("ken");
    const first = await store.close(round.code, "ken");
    const second = await store.close(round.code, "ken");
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.state.round.closedAt).toBe(first.state.round.closedAt);
    }
  });
});
