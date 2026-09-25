// The deploy-ahead path: when migration 0157's function is missing, the
// withdrawn set is read directly (batched auth bans, suspended Social rows and
// their aliases), and when that read fails too the error reaches the caller.
// Moderation never fails open.

import { beforeEach, describe, expect, it, vi } from "vitest";

type TableResult = { data: unknown[] | null; error: { message: string } | null };

const fake = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as { code?: string; message: string } | null },
  users: [] as Array<{ id: string; banned_until?: string | null }>,
  listUsersError: null as { message: string } | null,
  tables: {} as Record<string, TableResult>,
  queried: [] as string[],
}));

function builder(table: string) {
  const result = () => fake.tables[table] ?? { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "eq"]) chain[method] = () => chain;
  chain.then = (resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) => {
    fake.queried.push(table);
    return Promise.resolve(result()).then(resolve, reject);
  };
  return chain;
}

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseAdmin: () => ({
      rpc: async () => fake.rpc,
      from: (table: string) => builder(table),
      auth: {
        admin: {
          listUsers: async () =>
            fake.listUsersError
              ? { data: { users: [] }, error: fake.listUsersError }
              : { data: { users: fake.users }, error: null },
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

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";

const FUTURE = "2126-01-01T00:00:00.000Z";

beforeEach(() => {
  fake.rpc = { data: null, error: { code: "PGRST202", message: "function not found" } };
  fake.users = [
    { id: "user-banned", banned_until: FUTURE },
    { id: "user-lifted", banned_until: "2020-01-01T00:00:00.000Z" },
    { id: "user-live", banned_until: null },
  ];
  fake.listUsersError = null;
  fake.tables = {
    profiles: { data: [{ id: "profile-banned", handle: "karansdad" }], error: null },
    private_social_accounts: {
      data: [{ profiles: { id: "profile-suspended", handle: "nikhil_x" } }],
      error: null,
    },
    profile_handle_aliases: {
      data: [{ profile_id: "profile-banned", handle: "nikhil_old" }],
      error: null,
    },
  };
  fake.queried = [];
  logged.length = 0;
});

describe("withdrawn set before migration 0157 is applied", () => {
  it("logs the missing function and reads the same rule directly", async () => {
    const hidden = await withdrawnHandles(["karansdad", "nikhil_x", "nikhil_old", "alice"]);
    expect([...hidden].sort()).toEqual(["karansdad", "nikhil_old", "nikhil_x"]);
    expect(logged).toEqual([
      { level: "error", event: "account_public_access.withdrawn_rpc_failed" },
    ]);
  });

  it("answers from the function alone once it is applied", async () => {
    fake.rpc = {
      data: [
        { profile_id: "profile-banned", handle: "karansdad" },
        { profile_id: "profile-banned", handle: "nikhil_old" },
      ],
      error: null,
    };
    const hidden = await withdrawnHandles(["karansdad", "nikhil_old", "alice"]);
    expect([...hidden].sort()).toEqual(["karansdad", "nikhil_old"]);
    expect(fake.queried).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("refuses rather than fails open when the direct read cannot answer", async () => {
    fake.tables.private_social_accounts = { data: null, error: { message: "social down" } };
    await expect(withdrawnHandles(["karansdad"])).rejects.toThrow("social down");

    fake.tables.private_social_accounts = { data: [], error: null };
    fake.listUsersError = { message: "gotrue down" };
    await expect(withdrawnHandles(["karansdad"])).rejects.toThrow("gotrue down");
  });
});
