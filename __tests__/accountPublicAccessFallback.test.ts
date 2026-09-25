// The deploy-ahead path: when migration 0157's function is missing, the
// withdrawn set is read directly for the profiles in question only (their
// aliases, suspended Social rows and each owner's auth ban), never by listing
// every auth user. Answers are held for a minute, a failure is never held, and
// when the direct read fails too the error reaches the caller: moderation
// never fails open.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TableResult = { data: unknown[] | null; error: { message: string } | null };

const fake = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { code?: string; message: string } | null },
  rpcCalls: 0,
  bans: {} as Record<string, string | null>,
  getUserByIdCalls: [] as string[],
  getUserByIdError: null as { message: string } | null,
  listUsersCalls: 0,
  tables: {} as Record<string, TableResult>,
}));

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "eq"]) chain[method] = () => chain;
  chain.then = (resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(fake.tables[table] ?? { data: [], error: null }).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: () => ({
      rpc: async () => {
        fake.rpcCalls += 1;
        return fake.rpc;
      },
      from: (table: string) => builder(table),
      auth: {
        admin: {
          listUsers: async () => {
            fake.listUsersCalls += 1;
            return { data: { users: [] }, error: null };
          },
          getUserById: async (id: string) => {
            fake.getUserByIdCalls.push(id);
            if (fake.getUserByIdError) return { data: { user: null }, error: fake.getUserByIdError };
            return { data: { user: { id, banned_until: fake.bans[id] ?? null } }, error: null };
          },
        },
      },
    }),
  };
});

const logged = vi.hoisted(() => [] as Array<{ level: string; event: string }>);
vi.mock("@/lib/log", () => ({
  log: (level: string, event: string) => {
    logged.push({ level, event });
  },
}));

import {
  __resetMemoryProfileWithdrawals,
  withdrawnHandles,
} from "@/lib/accountPublicAccess.server";

const FUTURE = "2126-01-01T00:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z"));
  __resetMemoryProfileWithdrawals();
  fake.rpc = { data: null, error: { code: "PGRST202", message: "function not found" } };
  fake.rpcCalls = 0;
  fake.bans = { "user-banned": FUTURE, "user-alice": null };
  fake.getUserByIdCalls = [];
  fake.getUserByIdError = null;
  fake.listUsersCalls = 0;
  fake.tables = {
    profiles: {
      data: [
        { id: "profile-banned", handle: "karansdad", user_id: "user-banned" },
        { id: "profile-suspended", handle: "nikhil_x", user_id: null },
        { id: "profile-alice", handle: "alice", user_id: "user-alice" },
      ],
      error: null,
    },
    private_social_accounts: { data: [{ profile_id: "profile-suspended" }], error: null },
    profile_handle_aliases: {
      data: [{ profile_id: "profile-banned", handle: "nikhil_old" }],
      error: null,
    },
  };
  logged.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withdrawn set before migration 0157 is applied", () => {
  it("reads the rule for the authors in question, never listing every auth user", async () => {
    const hidden = await withdrawnHandles(["karansdad", "nikhil_x", "nikhil_old", "alice"]);
    expect([...hidden].sort()).toEqual(["karansdad", "nikhil_old", "nikhil_x"]);
    expect(fake.listUsersCalls).toBe(0);
    expect(fake.getUserByIdCalls.sort()).toEqual(["user-alice", "user-banned"]);
  });

  it("logs the miss and asks the function again only once a minute, holding each ban", async () => {
    await withdrawnHandles(["karansdad", "alice"]);
    await withdrawnHandles(["karansdad", "alice"]);
    expect(fake.rpcCalls).toBe(1);
    expect(logged).toEqual([
      { level: "error", event: "account_public_access.withdrawn_rpc_failed" },
    ]);
    expect(fake.getUserByIdCalls).toHaveLength(2);

    vi.advanceTimersByTime(60_000);
    await withdrawnHandles(["karansdad", "alice"]);
    expect(fake.rpcCalls).toBe(2);
    expect(logged).toHaveLength(2);
    expect(fake.getUserByIdCalls).toHaveLength(4);
  });

  it("holds the function's answer for a minute once it is applied", async () => {
    fake.rpc = {
      data: [
        { profile_id: "profile-banned", handle: "karansdad" },
        { profile_id: "profile-banned", handle: "nikhil_old" },
      ],
      error: null,
    };
    const hidden = await withdrawnHandles(["karansdad", "nikhil_old", "alice"]);
    expect([...hidden].sort()).toEqual(["karansdad", "nikhil_old"]);
    await withdrawnHandles(["karansdad"]);
    expect(fake.rpcCalls).toBe(1);
    expect(fake.getUserByIdCalls).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("refuses rather than fails open, and never holds a failure", async () => {
    fake.getUserByIdError = { message: "gotrue down" };
    await expect(withdrawnHandles(["karansdad"])).rejects.toThrow("gotrue down");

    fake.getUserByIdError = null;
    fake.tables.private_social_accounts = { data: null, error: { message: "social down" } };
    await expect(withdrawnHandles(["karansdad"])).rejects.toThrow("social down");

    fake.tables.private_social_accounts = { data: [], error: null };
    await expect(withdrawnHandles(["karansdad"])).resolves.toEqual(new Set(["karansdad"]));
  });
});
