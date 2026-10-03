import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

const KNOWN = new Map<string, Record<string, unknown>>([
  ["ken", profileRow("profile-ken", "ken")],
  ["sam", profileRow("profile-sam", "sam")],
]);

function profileRow(id: string, handle: string): Record<string, unknown> {
  return {
    id,
    handle,
    created_at: "2026-07-07T12:00:00.000Z",
    updated_at: "2026-07-07T12:00:00.000Z",
  };
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => makeQuery(table) }),
  requireSupabaseAdmin: () => ({ from: (table: string) => makeQuery(table) }),
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
}));

function makeQuery(table: string) {
  const filters: { column: string; value: unknown }[] = [];
  let inserted: Record<string, unknown> | null = null;

  function result() {
    if (inserted) return { data: [inserted], error: null };
    if (table === "profiles") {
      const handle = filters.find((filter) => filter.column === "handle")?.value;
      const row = typeof handle === "string" ? KNOWN.get(handle) : undefined;
      return { data: row ? [row] : [], error: null };
    }
    if (table === "saved_pubs") {
      const rows = recorded.inserts
        .filter((entry) => entry.table === "saved_pubs")
        .map((entry) => ({
          venue_id: entry.row.venue_id,
          list_type: entry.row.list_type,
          note: entry.row.note ?? null,
          created_at: "2026-07-07T12:00:00.000Z",
        }));
      return { data: rows, error: null, count: rows.length };
    }
    if (table === "saved_list_follows" || table === "saved_lists") {
      return { data: [], error: null, count: 0 };
    }
    return { data: [], error: null, count: 0 };
  }

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    in(column: string, value: unknown) {
      filters.push({ column, value });
      return query;
    },
    is() {
      return query;
    },
    not() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    insert(row: Record<string, unknown>) {
      inserted = row;
      recorded.inserts.push({ table, row });
      return query;
    },
    delete() {
      return query;
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

import {
  supabaseSavedListFollowsStore,
  supabaseSavedListsStore,
  supabaseSavedPubsStore,
} from "@/lib/savedPubsStore";

beforeEach(() => {
  recorded.inserts.length = 0;
});

function profileInserts(): { table: string; row: Record<string, unknown> }[] {
  return recorded.inserts.filter((entry) => entry.table === "profiles");
}

describe("durable saved pubs do not mint a profile", () => {
  it("stores nothing for an anonymous handle that has no row", async () => {
    const saved = await supabaseSavedPubsStore.toggleSaved({
      handle: "freshmint",
      venueId: "venue-mint-test",
      listType: "Historic",
    });

    expect(saved).toEqual([]);
    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts).toEqual([]);
  });

  it("saves against a profile that already exists and does not insert another", async () => {
    const saved = await supabaseSavedPubsStore.toggleSaved({
      handle: "ken",
      venueId: "venue-mint-test",
      listType: "Historic",
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ venueId: "venue-mint-test", listType: "Historic" });
    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts.map((entry) => entry.table)).toEqual(["saved_pubs"]);
  });

  it("does not register a custom list by minting a profile", async () => {
    await expect(supabaseSavedListsStore.createList("freshmint", "Sunday Roasts")).resolves.toEqual([]);
    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts).toEqual([]);

    const lists = await supabaseSavedListsStore.createList("ken", "Sunday Roasts");
    expect(lists).toEqual([]);
    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts.map((entry) => entry.table)).toEqual(["saved_lists"]);
  });
});

describe("durable list follows do not mint a profile", () => {
  it("refuses a follow that would mint the follower or the named owner", async () => {
    await expect(
      supabaseSavedListFollowsStore.followList("freshmint", "victim", "Date Night"),
    ).resolves.toBe(false);
    await expect(
      supabaseSavedListFollowsStore.followList("ken", "victim", "Date Night"),
    ).resolves.toBe(false);

    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts).toEqual([]);
  });

  it("follows when both profiles already exist", async () => {
    await expect(
      supabaseSavedListFollowsStore.followList("ken", "sam", "Date Night"),
    ).resolves.toBe(true);

    expect(profileInserts()).toEqual([]);
    expect(recorded.inserts).toEqual([
      {
        table: "saved_list_follows",
        row: {
          follower_profile_id: "profile-ken",
          list_owner_profile_id: "profile-sam",
          list_name: "Date Night",
        },
      },
    ]);
  });
});
