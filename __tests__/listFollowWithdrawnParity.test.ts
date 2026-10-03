import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  profiles: new Map<string, string>(),
  ensured: [] as string[],
  edges: [] as { follower: string; owner: string; list: string }[],
  withdrawn: new Set<string>(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  const admin = { from: (table: string) => fakeTable(table) };
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => false,
    getSupabaseAdmin: () => admin,
    requireSupabaseAdmin: () => admin,
  };
});

vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  const record = (handle: string) => {
    const id = db.profiles.get(handle);
    return id ? { id, handle, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } : null;
  };
  return {
    ...actual,
    supabaseProfileStore: {
      ...actual.supabaseProfileStore,
      getByHandle: async (handle: string) => record(handle),
      ensure: async (handle: string) => {
        db.ensured.push(handle);
        if (!db.profiles.has(handle)) db.profiles.set(handle, `profile-${handle}`);
        return record(handle);
      },
    },
  };
});

vi.mock("@/lib/accountPublicAccess.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountPublicAccess.server")>();
  return {
    ...actual,
    withdrawnHandles: async (handles: readonly string[]) =>
      new Set(handles.filter((handle) => db.withdrawn.has(handle))),
  };
});

vi.mock("@/lib/messageAuth", () => ({ resolveMessageHandle: async () => "alice" }));

vi.mock("@/lib/profileOwnership", () => ({
  gateHandleAction: async () => ({ allowed: true, callerUserId: "user-alice", handle: "alice" }),
  callerOwnedWithdrawnHandle: async () => undefined,
}));

vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));

type Filter = { column: string; value: unknown };

function fakeTable(table: string) {
  const filters: Filter[] = [];
  const value = (column: string) => filters.find((filter) => filter.column === column)?.value;
  const matching = () =>
    table === "saved_list_follows"
      ? db.edges.filter(
          (edge) =>
            (value("follower_profile_id") === undefined || edge.follower === value("follower_profile_id")) &&
            edge.owner === value("list_owner_profile_id") &&
            edge.list === value("list_name"),
        )
      : [];
  const query = {
    select: () => query,
    eq(column: string, filterValue: unknown) {
      filters.push({ column, value: filterValue });
      return query;
    },
    limit: async () => ({ data: matching().map(() => ({ id: "edge" })), error: null }),
    async insert(row: { follower_profile_id: string; list_owner_profile_id: string; list_name: string }) {
      db.edges.push({ follower: row.follower_profile_id, owner: row.list_owner_profile_id, list: row.list_name });
      return { error: null };
    },
    delete: () => query,
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { count: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve({ count: matching().length, error: null }).then(onfulfilled, onrejected);
    },
  };
  return query;
}

import { POST } from "@/app/api/saved-pubs/list-follows/route";

const LIST = "Date night";
const UNKNOWN = "neverexisted_qa9";

function follow(owner: string, action = "follow"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/saved-pubs/list-follows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ follower: "alice", owner, listType: LIST, action }),
    }),
  );
}

async function answered(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  db.profiles = new Map([
    ["alice", "profile-alice"],
    ["sam", "profile-sam"],
    ["suspendedbob", "profile-suspendedbob"],
    ["bannedbob", "profile-bannedbob"],
  ]);
  db.ensured = [];
  db.edges = [];
  db.withdrawn = new Set(["suspendedbob", "bannedbob"]);
});

describe("list follow write parity", () => {
  it("follows a live owner's list", async () => {
    expect(await answered(await follow("sam"))).toEqual({
      status: 200,
      body: { following: true, counts: { followers: 1, savedPubs: 0 } },
    });
    expect(db.edges).toEqual([{ follower: "profile-alice", owner: "profile-sam", list: LIST }]);
  });

  it("refuses a list follow on a handle nobody owns without creating it", async () => {
    const unknown = await answered(await follow(UNKNOWN));
    expect(unknown.status).toBe(404);
    expect(db.profiles.has(UNKNOWN)).toBe(false);
    expect(db.ensured).not.toContain(UNKNOWN);
    expect(db.edges).toEqual([]);
  });

  it.each(["suspendedbob", "bannedbob"])(
    "answers a list follow on %s exactly like one on a handle nobody owns, storing no edge",
    async (owner) => {
      const unknown = await answered(await follow(UNKNOWN));
      expect(await answered(await follow(owner))).toEqual(unknown);
      expect(db.edges).toEqual([]);
    },
  );

  it.each(["suspendedbob", "bannedbob"])(
    "answers a list unfollow on %s exactly like one on a handle nobody owns",
    async (owner) => {
      const unknown = await answered(await follow(UNKNOWN, "unfollow"));
      expect(await answered(await follow(owner, "unfollow"))).toEqual(unknown);
    },
  );
});
