import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  selects: [] as { table: string; columns: string }[],
  followedRows: [] as {
    list_owner_profile_id: string;
    list_name: string;
    created_at: string;
    owner: { handle: string; tombstoned_at?: string | null };
  }[],
  hiddenHandles: [] as string[],
  withdrawalReads: [] as string[][],
}));

vi.mock("@/lib/accountPublicAccess.server", () => ({
  withdrawnHandles: async (handles: readonly string[]) => {
    supabaseMock.withdrawalReads.push([...handles]);
    return new Set(handles.filter((handle) => supabaseMock.hiddenHandles.includes(handle)));
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => makeQuery(table),
  }),
  requireSupabaseAdmin: () => ({
    from: (table: string) => makeQuery(table),
  }),
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
}));

type Filter = { column: string; value: unknown };

function makeQuery(table: string) {
  const filters: Filter[] = [];
  let headCount = false;

  function result() {
    if (table === "profiles") {
      const handle = filters.find((f) => f.column === "handle")?.value;
      const id = handle === "ken" ? "profile-ken" : handle === "sam" ? "profile-sam" : "";
      return {
        data: id
          ? [
              {
                id,
                handle,
                created_at: "2026-07-07T12:00:00.000Z",
                updated_at: "2026-07-07T12:00:00.000Z",
              },
            ]
          : [],
        error: null,
      };
    }

    if (table === "saved_list_follows") {
      if (headCount) return { count: 1, error: null };
      return {
        data: supabaseMock.followedRows,
        error: null,
      };
    }

    if (table === "saved_pubs") {
      return { count: 2, error: null };
    }

    return { data: [], error: null };
  }

  const query = {
    select(columns: string, options?: { head?: boolean }) {
      supabaseMock.selects.push({ table, columns });
      headCount = Boolean(options?.head);
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    limit() {
      return Promise.resolve(result());
    },
    order() {
      return Promise.resolve(result());
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result()).then(onfulfilled, onrejected);
    },
  };

  return query;
}

beforeEach(() => {
  supabaseMock.selects = [];
  supabaseMock.hiddenHandles = [];
  supabaseMock.withdrawalReads = [];
  supabaseMock.followedRows = [{
    list_owner_profile_id: "profile-sam",
    list_name: "Date Night",
    created_at: "2026-07-07T12:00:00.000Z",
    owner: { handle: "sam", tombstoned_at: null },
  }];
});

describe("savedListFollowsStore — Supabase adapter", () => {
  it("embeds the followed list owner through the explicit profiles foreign key", async () => {
    const { supabaseSavedListFollowsStore } = await import("@/lib/savedPubsStore");

    const followed = await supabaseSavedListFollowsStore.listFollowedBy("ken");

    expect(followed[0]).toMatchObject({
      ownerHandle: "sam",
      listType: "Date Night",
      savedCount: 2,
      followerCount: 1,
    });
    expect(
      supabaseMock.selects.find(
        (call) => call.table === "saved_list_follows" && call.columns.includes("owner:"),
      )?.columns,
    ).toContain("owner:profiles!saved_list_follows_list_owner_profile_id_fkey(handle, tombstoned_at)");
  });

  it("filters deleted and withdrawn owners without profile queries per list", async () => {
    const { savedListFollowsStore } = await import("@/lib/savedPubsStore");
    supabaseMock.followedRows = Array.from({ length: 24 }, (_, index) => ({
      list_owner_profile_id: `profile-owner${index}`,
      list_name: `Friday ${index}`,
      created_at: "2026-07-07T12:00:00.000Z",
      owner: { handle: `owner${index}`, tombstoned_at: index === 0 ? "2026-11-22T12:00:00Z" : null },
    }));
    supabaseMock.hiddenHandles = ["owner0", "owner1"];

    for (const ownHandle of [undefined, "owner0", "owner1"]) {
      supabaseMock.selects = [];
      supabaseMock.withdrawalReads = [];
      const followed = await savedListFollowsStore(ownHandle).listFollowedBy("ken");
      expect(followed.map((list) => list.ownerHandle)).toEqual(
        Array.from({ length: ownHandle === "owner1" ? 23 : 22 }, (_, index) =>
          `owner${index + (ownHandle === "owner1" ? 1 : 2)}`),
      );
      expect(supabaseMock.selects.filter((call) => call.table === "profiles")).toHaveLength(2);
      expect(supabaseMock.withdrawalReads).toHaveLength(2);
      expect(supabaseMock.withdrawalReads[0]).toEqual(["ken"]);
      expect(supabaseMock.withdrawalReads[1]).toHaveLength(ownHandle === "owner1" ? 22 : 23);
    }
  });
});
