import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

// A retired alias (a renamed account's previous handle) lives only in the alias
// ledger, and the memory rename does not move a profiles row, so the alias
// state is set here. `aliases` maps each handle to its profile id.
const identity = vi.hoisted(() => ({ aliases: new Map<string, string>() }));
vi.mock("@/lib/identityHandleStore", () => ({
  identityHandleStore: () => ({
    aliasProfileId: async (handle: string) => identity.aliases.get(handle) ?? null,
  }),
}));

import { callerUserId } from "@/lib/authServer";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
  __seedMemoryLegacyProfile,
  __seedMemoryOwnedProfile,
  __tombstoneMemoryProfile,
} from "@/lib/profileStore";

const mockedCaller = vi.mocked(callerUserId);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
  identity.aliases.clear();
  mockedCaller.mockReset();
  mockedCaller.mockResolvedValue(null);
});

function req(init?: RequestInit): Request {
  return new Request("http://localhost/api/test", init);
}

describe("gateHandleAction", () => {
  it("400s a blank handle", async () => {
    const gate = await gateHandleAction(req(), "   ");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(400);
  });

  it("allows an anonymous caller on an unlinked handle (demo path)", async () => {
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(true);
  });

  it("REJECTS an anonymous caller on a linked handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("allows the matching owner and is idempotent when already linked", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    mockedCaller.mockResolvedValue("user-abc");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(true);
  });

  it("does not link on authenticated read of an unlinked handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const gate = await gateHandleAction(req(), "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row).toBeNull();
  });

  it("links on first authenticated write of an unlinked handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const gate = await gateHandleAction(req({ method: "POST" }), "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row?.userId).toBe("user-new");
  });

  it.each(["karan", "sarah", "carol", "erin"])(
    "never links reserved handle %s on authenticated write",
    async (handle) => {
      mockedCaller.mockResolvedValue("user-new");

      const gate = await gateHandleAction(req({ method: "POST" }), handle);

      expect(gate).toMatchObject({
        allowed: false,
        status: 409,
        error: "That handle is not available.",
      });
      expect((await memoryProfileStore.getByHandle(handle))?.userId).toBeUndefined();
    },
  );

  it.each(["karan", "Karan", "KARAN"])(
    "allows the owner to save reserved handle %s idempotently",
    async (handle) => {
      await __seedMemoryOwnedProfile("karan", "founder-user");
      mockedCaller.mockResolvedValue("founder-user");

      const gate = await gateHandleAction(req({ method: "PATCH" }), handle);

      expect(gate.allowed).toBe(true);
      if (gate.allowed) expect(gate.callerUserId).toBe("founder-user");
    },
  );

  it("REJECTS a different signed-in user on a linked handle", async () => {
    await memoryProfileStore.createOwned("ken", "user-abc");
    mockedCaller.mockResolvedValue("user-xyz");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("returns 409 when a concurrent claim takes an absent handle", async () => {
    mockedCaller.mockResolvedValue("user-new");
    const createSpy = vi
      .spyOn(memoryProfileStore, "createOwned")
      .mockRejectedValueOnce(new Error("That handle is not available."));
    const gate = await gateHandleAction(req({ method: "POST" }), "racy");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(409);
    createSpy.mockRestore();
  });

  it("returns 409 when the account already owns another handle", async () => {
    await memoryProfileStore.createOwned("owned_name", "user-new");
    mockedCaller.mockResolvedValue("user-new");

    const gate = await gateHandleAction(req({ method: "POST" }), "second_name");

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(409);
  });
});

// Audit finding lib/profileOwnership:gateHandleAction-unlinked-lane-ignores-tombstone-and-retired-alias.
// The demo lane is for a handle nobody holds. A deleted account's tombstone and
// a renamed account's retired alias are both held, and the claim and rename
// doors already refuse them, so the anonymous lane may not write under them.
describe("gateHandleAction on a reserved handle", () => {
  const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

  it.each(METHODS)("answers 404 to every caller on a deleted account's profile (%s)", async (method) => {
    await __seedMemoryOwnedProfile("departed", "user-departed");
    __tombstoneMemoryProfile("departed");
    for (const caller of [null, "user-other"]) {
      mockedCaller.mockResolvedValue(caller);
      const gate = await gateHandleAction(req({ method }), "departed");
      expect(gate).toEqual({ allowed: false, status: 404, error: "Profile not found." });
    }
  });

  it("keeps the inbox read's not-owner answer on a tombstone", async () => {
    await __seedMemoryOwnedProfile("departed", "user-departed");
    __tombstoneMemoryProfile("departed");
    const gate = await gateHandleAction(req(), "departed", null, { requireAccountOwner: true });
    expect(gate).toMatchObject({ allowed: false, status: 403 });
  });

  it("still opens the demo lane on a legacy row with no owner and no tombstone", async () => {
    __seedMemoryLegacyProfile("legacy_name");
    const gate = await gateHandleAction(req({ method: "PATCH" }), "legacy_name");
    expect(gate).toMatchObject({ allowed: true, callerUserId: null });
  });

  it.each(METHODS)("answers 409 to a stranger on a retired alias (%s)", async (method) => {
    identity.aliases.set("old_name", "user-renamed");
    for (const caller of [null, "user-other", "user-renamed"]) {
      mockedCaller.mockResolvedValue(caller);
      const gate = await gateHandleAction(req({ method }), "old_name");
      expect(gate).toEqual({ allowed: false, status: 409, error: "That handle is not available." });
    }
    expect(await memoryProfileStore.getByHandle("old_name")).toBeNull();
  });

  it.each(METHODS)("refuses an existing unowned alias collision (%s)", async (method) => {
    __seedMemoryLegacyProfile("old_name");
    identity.aliases.set("old_name", "another-profile");
    expect(await gateHandleAction(req({ method }), "old_name")).toMatchObject({
      allowed: false, status: 409,
    });
    expect(await memoryProfileStore.getByHandle("old_name")).not.toBeNull();
  });
});
