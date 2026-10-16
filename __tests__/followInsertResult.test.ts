import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  error: null as { code: string; message: string } | null,
}));

// Exercise the durable store's insert result without contacting a database.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({
      from: () => ({ insert: async () => ({ error: backend.error }) }),
    }),
  };
});
vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return { ...actual, supabaseProfileStore: actual.memoryProfileStore };
});

import { followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  backend.error = null;
  __resetMemoryProfiles();
});

describe("durable follow insert result", () => {
  it("reports a new edge only for a successful insert", async () => {
    expect(await followStore().followIfNew("guest", "host")).toBe("created");
    expect(await followStore().follow("guest", "host")).toBe(true);
  });

  it("reports an existing edge for the database uniqueness refusal", async () => {
    backend.error = { code: "23505", message: "Duplicate follow edge" };
    expect(await followStore().followIfNew("guest", "host")).toBe("already");
    expect(await followStore().follow("guest", "host")).toBe(true);
  });

  it("keeps a database failure distinct from an existing edge", async () => {
    backend.error = { code: "42501", message: "Permission denied" };
    await expect(followStore().followIfNew("guest", "host")).rejects.toThrow("Permission denied");
    await expect(followStore().follow("guest", "host")).rejects.toThrow("Permission denied");
  });

  it("refuses self-follow before inserting", async () => {
    expect(await followStore().followIfNew("@Host", "host")).toBe("self");
    expect(await followStore().follow("@Host", "host")).toBe(false);
  });
});
