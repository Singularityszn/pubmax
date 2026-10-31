import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  profile_handle_aliases: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({ order: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }),
  }),
  requireSupabaseAdmin: () => ({
    from: (table: keyof typeof rows) => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: rows[table], error: null }),
        }),
      }),
    }),
  }),
  isSupabaseConfigured: () => true,
}));

import { supabaseIdentityHandleStore } from "@/lib/identityHandleStore";

beforeEach(() => {
  rows.profile_handle_aliases = [];
  rows.profiles = [];
});

describe("Supabase handle availability", () => {
  it("treats an unaliased generic profile row as taken", async () => {
    rows.profiles = [{ id: "profile-1" }];

    await expect(
      supabaseIdentityHandleStore.availability("anonymous_night"),
    ).resolves.toEqual({
      handle: "anonymous_night",
      available: false,
      reason: "taken",
    });
  });

  it("reports an absent handle as available", async () => {
    await expect(
      supabaseIdentityHandleStore.availability("brand_new_night"),
    ).resolves.toEqual({
      handle: "brand_new_night",
      available: true,
    });
  });
});

describe("Supabase public handle resolution", () => {
  it.each([false, true])("withholds the smoke account with alias: %s", async (alias) => {
    rows.profiles = [{ id: "smoke-id", handle: "pubmaxx_smoke", user_id: "smoke-owner", tombstoned_at: null }];
    if (alias) rows.profile_handle_aliases = [{ profile_id: "smoke-id", is_current: false }];
    await expect(supabaseIdentityHandleStore.resolve(alias ? "old-smoke" : "pubmaxx_smoke")).resolves.toBeNull();
  });

  it.each([false, true])("keeps ordinary live profiles visible with alias: %s", async (alias) => {
    rows.profiles = [{ id: "real-id", handle: "smokey", user_id: null, tombstoned_at: null }];
    if (alias) rows.profile_handle_aliases = [{ profile_id: "real-id", is_current: false }];
    await expect(supabaseIdentityHandleStore.resolve(alias ? "old-name" : "smokey")).resolves.toEqual({
      profileId: "real-id", requestedHandle: alias ? "old-name" : "smokey", currentHandle: "smokey",
      redirect: alias, status: "live",
    });
  });

  it.each([false, true])("preserves deleted profile tombstones with alias: %s", async (alias) => {
    rows.profiles = [{ id: "gone-id", handle: "departed", user_id: null, tombstoned_at: "2026-10-23T16:00:00Z" }];
    if (alias) rows.profile_handle_aliases = [{ profile_id: "gone-id", is_current: false }];
    await expect(supabaseIdentityHandleStore.resolve(alias ? "old-name" : "departed")).resolves.toMatchObject({
      profileId: "gone-id", currentHandle: "departed", redirect: false, status: "gone",
    });
  });
});

describe("Supabase worn handles", () => {
  it("reads every handle the account has worn, and the one it wears today", async () => {
    rows.profile_handle_aliases = [
      { profile_id: "profile-1", handle: "old_name", is_current: false },
      { profile_id: "profile-1", handle: "new_name", is_current: true },
    ];

    await expect(supabaseIdentityHandleStore.wornHandles("old_name")).resolves.toEqual({
      currentHandle: "new_name",
      handles: ["new_name", "old_name"],
    });
  });

  it("answers null for a handle with no alias history", async () => {
    await expect(supabaseIdentityHandleStore.wornHandles("never_claimed")).resolves.toBeNull();
  });
});
