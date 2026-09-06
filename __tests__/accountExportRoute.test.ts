import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/account/export — the portable copy of the caller's own data.
//
// The one thing this file exists to prove is that the account exported is the
// account that asked: an owner gets their own document, another signed-in
// account gets THEIR own and never the first one's, and anonymous gets 401.
// The rest (the limiter, the refusal when a lane could not be read, the file
// header) is the ordinary route contract.

const storeState = vi.hoisted(() => ({ durable: true }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => storeState.durable,
    requiresSupabaseStore: () => false,
  };
});
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return { ...actual, profileStore: () => actual.memoryProfileStore };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

// The assembler is proved separately (__tests__/accountExport.test.ts). Here it
// is a spy that records WHICH id the route handed it and answers a document
// the test controls.
const exportState = vi.hoisted(() => ({
  calls: [] as string[],
  unavailable: [] as string[],
}));
vi.mock("@/lib/accountExport.server", async () => {
  const { ACCOUNT_EXPORT_LANES } = await import("@/lib/accountExport");
  return {
  buildAccountExport: async (userId: string) => {
    exportState.calls.push(userId);
    const lane = (name: string) => ({
      status: exportState.unavailable.includes(name) ? "unavailable" : "complete",
      truncated: false,
      items: [] as unknown[],
    });
    // Every lane the document names, built off the ONE table, so a lane added
    // to `ACCOUNT_EXPORT_LANES` cannot leave this double behind.
    const lanes = Object.fromEntries(
      ACCOUNT_EXPORT_LANES.map((name) => [name, lane(name)]),
    );
    return {
      version: 1,
      exportedAt: "2026-09-05T18:00:00.000Z",
      account: { userId, handle: userId === "user-owner" ? "night_owl" : null, displayName: null },
      ...lanes,
    };
  },
  };
});

import { GET } from "@/app/api/account/export/route";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

const ROUTE_URL = "http://localhost/api/account/export";

function callerId(label: string): string {
  return `user-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

function get(headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(ROUTE_URL, { method: "GET", headers }));
}

type Body = {
  error?: string;
  code?: string;
  retryable?: boolean;
  details?: { lanes?: string[] };
  account?: { userId?: string; handle?: string | null };
};

beforeEach(() => {
  storeState.durable = true;
  authState.userId = null;
  exportState.calls = [];
  exportState.unavailable = [];
  __resetMemoryProfiles();
});

describe("GET /api/account/export", () => {
  it("hands the owner their own document as a file", async () => {
    authState.userId = "user-owner";
    await memoryProfileStore.createOwned("night_owl", "user-owner");

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="pubmaxx-night_owl-2026-09-05.json"',
    );
    const body = (await res.json()) as Body;
    expect(body.account?.userId).toBe("user-owner");
    expect(exportState.calls).toEqual(["user-owner"]);
  });

  it("exports the caller's account whatever the request names, so another user never reads the owner's", async () => {
    // The whole security argument: the target comes from the verified bearer,
    // and there is no query or header a stranger could aim at another account.
    const other = callerId("other");
    authState.userId = other;

    const res = await get({ "x-user-id": "user-owner", "x-handle": "night_owl" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.account?.userId).toBe(other);
    expect(exportState.calls).toEqual([other]);
    expect(exportState.calls).not.toContain("user-owner");
  });

  it("keeps the door for an account with no claimed handle", async () => {
    const caller = callerId("nohandle");
    authState.userId = caller;

    const res = await get();

    expect(res.status).toBe(200);
    expect(exportState.calls).toEqual([caller]);
  });

  it("refuses an anonymous caller with 401 and reads nothing", async () => {
    authState.userId = null;

    const res = await get();

    expect(res.status).toBe(401);
    expect(((await res.json()) as Body).code).toBe("UNAUTHENTICATED");
    expect(exportState.calls).toEqual([]);
  });

  it("rate-limits a burst from one account before any read", async () => {
    const caller = callerId("burst");
    authState.userId = caller;

    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await get()).status);

    const limited = statuses.filter((status) => status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(exportState.calls.length).toBe(statuses.length - limited.length);
  });

  it("refuses the whole export, naming the lane, when one lane could not be read", async () => {
    const caller = callerId("degraded");
    authState.userId = caller;
    exportState.unavailable = ["messages"];

    const res = await get();

    expect(res.status).toBe(503);
    const body = (await res.json()) as Body;
    expect(body.code).toBe("STORE_UNAVAILABLE");
    expect(body.retryable).toBe(true);
    expect(body.details?.lanes).toEqual(["messages"]);
    expect(body.account).toBeUndefined();
  });
});
