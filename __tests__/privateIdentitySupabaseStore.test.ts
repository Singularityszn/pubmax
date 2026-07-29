import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upserted: null as Record<string, unknown> | null,
}));

const existing = {
  user_id: "user-1",
  date_of_birth: "2015-02-03",
  full_name: null,
  sex: null,
  created_at: "2026-07-29T10:00:00.000Z",
  updated_at: "2026-07-29T10:00:00.000Z",
};

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: async () => ({ id: "profile-1", handle: "night_owl" }),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({ data: [existing], error: null }),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        state.upserted = row;
        return {
          select: () => ({
            limit: async () => ({
              data: [{ ...existing, ...row, full_name: row.full_name }],
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));

import { supabasePrivateIdentityStore } from "@/lib/privateIdentityStore";

beforeEach(() => {
  state.upserted = null;
});

describe("Supabase private identity updates", () => {
  it("preserves stored date of birth during optional-field edits", async () => {
    await expect(
      supabasePrivateIdentityStore.updateDetails("user-1", {
        fullName: "Night Owl",
      }),
    ).resolves.toMatchObject({
      dateOfBirth: "2015-02-03",
      fullName: "Night Owl",
    });
    expect(state.upserted).toMatchObject({
      user_id: "user-1",
      date_of_birth: "2015-02-03",
      full_name: "Night Owl",
    });
  });
});
