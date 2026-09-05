import { beforeEach, describe, expect, it, vi } from "vitest";

// DELETE /api/account — the in-app account-deletion door (App Store 5.1.1(v),
// Play's 2024 policy).
//
// The one thing this file exists to prove is that the account deleted is the
// account that asked. Everything else here (401, the limiter, the idempotent
// second call, the honest 503) is the ordinary route contract, held so a
// rejection cycle is never spent on a door that half works.

const storeState = vi.hoisted(() => ({ durable: true }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => storeState.durable,
    requiresSupabaseStore: () => false,
  };
});
// The handle lookup behind `resolveMessageHandle` / `gateHandleAction` stays on
// the process-memory backend whichever answer `isSupabaseConfigured` gives, so a
// case can say "a durable store answered" without swapping the store it seeded.
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

// The admin write is its own seam and is proved separately
// (__tests__/accountDeletionStore.test.ts). Here it is a spy, because what this
// file asserts is WHICH id the route hands it.
const deleteState = vi.hoisted(() => ({
  calls: [] as string[],
  outcome: "deleted" as "deleted" | "already-gone" | "unavailable",
}));
vi.mock("@/lib/accountDeletion.server", () => ({
  deleteOwnAccount: async (userId: string) => {
    deleteState.calls.push(userId);
    return deleteState.outcome;
  },
}));

import { DELETE } from "@/app/api/account/route";
import {
  memoryProfileStore,
  __resetMemoryProfiles,
} from "@/lib/profileStore";

const ROUTE_URL = "http://localhost/api/account";

/** A fresh caller id per case: the in-memory limiter is keyed on it. */
function callerId(label: string): string {
  return `user-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

function del(body?: unknown): Promise<Response> {
  return DELETE(
    new Request(ROUTE_URL, {
      method: "DELETE",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}

async function envelope(res: Response): Promise<{ error?: string; code?: string }> {
  return (await res.json()) as { error?: string; code?: string };
}

beforeEach(() => {
  storeState.durable = true;
  authState.userId = null;
  deleteState.calls = [];
  deleteState.outcome = "deleted";
  __resetMemoryProfiles();
});

describe("DELETE /api/account", () => {
  it("deletes the caller's own account and says so", async () => {
    const caller = callerId("own");
    authState.userId = caller;

    const res = await del();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteState.calls).toEqual([caller]);
  });

  it("deletes the caller's account even when the request names somebody else", async () => {
    // The whole security argument: the target comes from the verified bearer,
    // so there is no field here a stranger could aim at another account.
    const caller = callerId("aimed");
    authState.userId = caller;

    const res = await del({ userId: "someone-else", handle: "victim", id: "victim" });

    expect(res.status).toBe(200);
    expect(deleteState.calls).toEqual([caller]);
    expect(deleteState.calls).not.toContain("someone-else");
  });

  it("deletes the account behind a claimed handle, through the ownership gate", async () => {
    const caller = callerId("claimed");
    await memoryProfileStore.createOwned("night_owl", caller);
    authState.userId = caller;

    const res = await del();

    expect(res.status).toBe(200);
    expect(deleteState.calls).toEqual([caller]);
  });

  it("refuses an anonymous caller with 401 and never calls the writer", async () => {
    authState.userId = null;

    const res = await del();

    expect(res.status).toBe(401);
    expect((await envelope(res)).code).toBe("UNAUTHENTICATED");
    expect(deleteState.calls).toEqual([]);
  });

  it("rate-limits a burst from one account", async () => {
    const caller = callerId("burst");
    authState.userId = caller;

    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await del()).status);
    }

    const limited = statuses.filter((status) => status === 429);
    expect(limited.length).toBeGreaterThan(0);
    // The limiter runs BEFORE the writer, so a refused request writes nothing.
    expect(deleteState.calls.length).toBe(statuses.length - limited.length);
  });

  it("carries the house envelope on a rate-limited answer", async () => {
    const caller = callerId("envelope");
    authState.userId = caller;
    let res = await del();
    for (let i = 0; i < 9 && res.status !== 429; i += 1) res = await del();

    expect(res.status).toBe(429);
    const body = (await res.json()) as { code?: string; retryable?: boolean };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryable).toBe(true);
  });

  it("answers a second delete the same way as the first", async () => {
    // A browser that never saw the first answer must not be told the account it
    // just deleted is still here.
    const caller = callerId("twice");
    authState.userId = caller;

    const first = await del();
    deleteState.outcome = "already-gone";
    const second = await del();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ deleted: true });
    expect(deleteState.calls).toEqual([caller, caller]);
  });

  it("reports a delete it could not run as a retryable 503", async () => {
    const caller = callerId("outage");
    authState.userId = caller;
    deleteState.outcome = "unavailable";

    const res = await del();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; retryable?: boolean };
    expect(body.code).toBe("STORE_UNAVAILABLE");
    expect(body.retryable).toBe(true);
  });

  it("refuses rather than throwing when the store is not configured", async () => {
    const caller = callerId("keyless");
    authState.userId = caller;
    storeState.durable = false;

    const res = await del();

    expect(res.status).toBe(503);
    expect((await envelope(res)).code).toBe("STORE_UNAVAILABLE");
    expect(deleteState.calls).toEqual([]);
  });
});
