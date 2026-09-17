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

// The bearer seam. `userId` is the account the token NAMES; `unavailable` is a
// verification we could not run at all. The route asks `verifyCallerAuth` with
// `{ localOnly: true }` on purpose (the local JWKS lane), so the mock records
// what it was asked with: a route that went back to asking the auth server for
// the ACCOUNT could not answer a caller whose auth row the first delete already
// removed. That option is this door's alone (review finding F-3); the default
// asks GoTrue so revocation holds everywhere else.
const authState = vi.hoisted(() => ({
  userId: null as string | null,
  unavailable: false,
  optionsSeen: [] as Array<Record<string, unknown> | undefined>,
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    verifyCallerAuth: async (_request: Request, options?: Record<string, unknown>) => {
      authState.optionsSeen.push(options);
      if (authState.unavailable) return { status: "unavailable" as const };
      return authState.userId
        ? {
            status: "verified" as const,
            identity: { id: authState.userId, email: null, createdAt: null },
          }
        : { status: "absent" as const };
    },
  };
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
  authState.unavailable = false;
  authState.optionsSeen = [];
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

  it("names the caller from the token\'s own claims, never from the account row", async () => {
    // THE REGRESSION. Verification scout verify-preview-4 measured a repeat
    // `DELETE /api/account` answering 401 `UNAUTHENTICATED` rather than the
    // documented 410: the route asked the auth server for the ACCOUNT, and the
    // first delete had removed the row, so every later request with that same
    // unexpired bearer read as `user_not_found`. Asking the auth server for the
    // account here is what makes the idempotent answer below unreachable.
    const caller = callerId("claims");
    authState.userId = caller;

    await del();

    expect(authState.optionsSeen).toEqual([{ localOnly: true }]);
  });

  it("reports a verification it could not run as a retryable 503, and writes nothing", async () => {
    // A read we could not run is a fact about US. Telling somebody who is
    // signed in that they are not is the one thing this may not answer.
    authState.userId = callerId("auth-outage");
    authState.unavailable = true;

    const res = await del();

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; retryable?: boolean };
    expect(body.code).toBe("AUTH_UNAVAILABLE");
    expect(body.retryable).toBe(true);
    expect(deleteState.calls).toEqual([]);
  });

  it("answers a second delete 410 Gone, and still says the account is deleted", async () => {
    // A browser that never saw the first answer must not be told the account it
    // just deleted is still here, so the body keeps `deleted: true`; a caller
    // reading the status alone must not read a repeat as a fresh deletion, so
    // the status says nothing was written this time.
    const caller = callerId("twice");
    authState.userId = caller;

    const first = await del();
    // The auth row is gone now; the bearer still verifies against the project
    // JWKS and still names this account, which is the whole reason the second
    // request reaches the writer at all rather than being turned away as
    // anonymous.
    deleteState.outcome = "already-gone";
    const second = await del();

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ deleted: true });
    expect(second.status).toBe(410);
    expect(second.headers.get("Cache-Control")).toBe("no-store");
    const body = (await second.json()) as { deleted?: boolean; code?: string; retryable?: boolean };
    expect(body.deleted).toBe(true);
    expect(body.code).toBe("ACCOUNT_GONE");
    expect(body.retryable).toBe(false);
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
