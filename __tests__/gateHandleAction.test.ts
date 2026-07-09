import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

import { callerUserId } from "@/lib/authServer";
import { gateHandleAction } from "@/lib/profileOwnership";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

const mockedCaller = vi.mocked(callerUserId);

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryProfiles();
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
    await memoryProfileStore.linkUser("ken", "user-abc");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("allows the matching owner and is idempotent when already linked", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
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

  it("REJECTS a different signed-in user on a linked handle", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
    mockedCaller.mockResolvedValue("user-xyz");
    const gate = await gateHandleAction(req(), "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });
});
