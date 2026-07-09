import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({
  callerUserId: vi.fn(),
}));

import { callerUserId } from "@/lib/authServer";
import { decideProfileWrite, gateHandleAction, shouldLinkUser } from "@/lib/profileOwnership";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

// Pure ownership decisions (user story 31). These are the gate the API seam
// enforces because writes go through the service role (RLS is bypassed). The
// security contract: an UNLINKED handle stays anonymously editable (demo); a
// LINKED handle is owner-only.

const OWNER = "user-abc";
const OTHER = "user-xyz";

describe("decideProfileWrite — unlinked handle (demo path preserved)", () => {
  it("allows an anonymous caller to write an unlinked handle", () => {
    const d = decideProfileWrite(null, null);
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.reason).toBe("unlinked");
  });

  it("allows a signed-in caller to write an unlinked handle (they'll claim it)", () => {
    const d = decideProfileWrite(null, OWNER);
    expect(d.allowed).toBe(true);
  });

  it("treats an empty-string user id on the row as unlinked", () => {
    expect(decideProfileWrite("", null).allowed).toBe(true);
  });
});

describe("decideProfileWrite — linked handle (owner-only)", () => {
  it("allows the matching authenticated owner", () => {
    const d = decideProfileWrite(OWNER, OWNER);
    expect(d.allowed).toBe(true);
    expect(d.allowed && d.reason).toBe("owner");
  });

  it("REJECTS an anonymous caller on a linked handle (no session)", () => {
    const d = decideProfileWrite(OWNER, null);
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.status).toBe(403);
  });

  it("REJECTS a different signed-in user (no hijack)", () => {
    const d = decideProfileWrite(OWNER, OTHER);
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.status).toBe(403);
  });
});

describe("shouldLinkUser — first-authenticated-touch linking (story 32)", () => {
  it("links when a signed-in caller touches an unlinked handle", () => {
    expect(shouldLinkUser(null, OWNER)).toBe(true);
  });

  it("does NOT link an anonymous caller", () => {
    expect(shouldLinkUser(null, null)).toBe(false);
  });

  it("does NOT re-link a handle already linked to the same caller (idempotent)", () => {
    expect(shouldLinkUser(OWNER, OWNER)).toBe(false);
  });
});

describe("gateHandleAction — shared route ownership seam", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetMemoryProfiles();
    vi.mocked(callerUserId).mockResolvedValue(null);
  });

  it("allows an anonymous caller on an unlinked handle", async () => {
    const req = new Request("http://localhost/api/x");
    const gate = await gateHandleAction(req, "ken");
    expect(gate.allowed).toBe(true);
  });

  it("REJECTS an anonymous caller on a linked handle", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
    const req = new Request("http://localhost/api/x");
    const gate = await gateHandleAction(req, "ken");
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.status).toBe(403);
  });

  it("allows the matching authenticated owner on a linked handle", async () => {
    await memoryProfileStore.linkUser("ken", "user-abc");
    vi.mocked(callerUserId).mockResolvedValue("user-abc");
    const req = new Request("http://localhost/api/x", {
      headers: { authorization: "Bearer fake" },
    });
    const gate = await gateHandleAction(req, "ken");
    expect(gate.allowed).toBe(true);
  });

  it("does not link on authenticated read of an unlinked handle", async () => {
    vi.mocked(callerUserId).mockResolvedValue("user-new");
    const req = new Request("http://localhost/api/x", {
      headers: { authorization: "Bearer fake" },
    });
    const gate = await gateHandleAction(req, "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row).toBeNull();
  });

  it("links on first authenticated write of an unlinked handle", async () => {
    vi.mocked(callerUserId).mockResolvedValue("user-new");
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { authorization: "Bearer fake" },
    });
    const gate = await gateHandleAction(req, "fresh");
    expect(gate.allowed).toBe(true);
    const row = await memoryProfileStore.getByHandle("fresh");
    expect(row?.userId).toBe("user-new");
  });
});
