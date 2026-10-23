import { beforeEach, describe, expect, it, vi } from "vitest";

// "We ask once": Pub Pal setup skips its own 18+ question for an account that
// has already answered as an adult. This is the read it asks, and the route
// that carries the answer to the setup screen.

const evidence = vi.hoisted(() => ({
  dateOfBirth: null as string | null,
  adultSelfAssertedAt: null as string | null,
  throws: false,
}));
const caller = vi.hoisted(() => ({ userId: "user-1" as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/adultSelfAssertionStore", () => ({
  adultSelfAssertionStore: () => ({
    read: async () => {
      if (evidence.throws) throw new Error("store down");
      return evidence.adultSelfAssertedAt;
    },
  }),
}));
vi.mock("@/lib/privateIdentityStore", () => ({
  privateIdentityStore: () => ({
    read: async () => (evidence.dateOfBirth ? { dateOfBirth: evidence.dateOfBirth } : null),
  }),
}));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => caller.userId }));
vi.mock("@/lib/pubPalStore", () => ({
  getPubPalResult: async () => ({ ok: true, value: null }),
  createPubPalResult: vi.fn(),
  deletePubPalResult: vi.fn(),
  updatePubPalResult: vi.fn(),
}));

import { GET } from "@/app/api/pub-pal/route";
import { accountAdultOnFile } from "@/lib/adultOnFile.server";

beforeEach(() => {
  evidence.dateOfBirth = null;
  evidence.adultSelfAssertedAt = null;
  evidence.throws = false;
  caller.userId = "user-1";
});

describe("accountAdultOnFile", () => {
  it("is false for an account that has answered nothing", async () => {
    expect(await accountAdultOnFile("user-1")).toBe(false);
  });

  it("is true once the account tapped \"I'm 18 or over\"", async () => {
    evidence.adultSelfAssertedAt = new Date().toISOString();
    expect(await accountAdultOnFile("user-1")).toBe(true);
  });

  it("is true for a stored adult date of birth", async () => {
    evidence.dateOfBirth = "1990-04-12";
    expect(await accountAdultOnFile("user-1")).toBe(true);
  });

  it("lets a stored under-18 date of birth overrule a tap, as the one adult gate does", async () => {
    const eleven = new Date();
    eleven.setUTCFullYear(eleven.getUTCFullYear() - 11);
    evidence.dateOfBirth = eleven.toISOString().slice(0, 10);
    evidence.adultSelfAssertedAt = new Date().toISOString();
    expect(await accountAdultOnFile("user-1")).toBe(false);
  });

  it("is false, so the question is asked, when a store cannot answer", async () => {
    evidence.throws = true;
    expect(await accountAdultOnFile("user-1")).toBe(false);
  });
});

describe("GET /api/pub-pal", () => {
  it("carries adultOnFile beside the Pal", async () => {
    evidence.adultSelfAssertedAt = new Date().toISOString();
    const res = await GET(new Request("http://localhost/api/pub-pal"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pal: null, adultOnFile: true });
  });

  it("is false for an account that has not answered", async () => {
    const res = await GET(new Request("http://localhost/api/pub-pal"));
    expect(await res.json()).toEqual({ pal: null, adultOnFile: false });
  });

  it("still answers 401 without a session", async () => {
    caller.userId = null;
    const res = await GET(new Request("http://localhost/api/pub-pal"));
    expect(res.status).toBe(401);
  });
});
