import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetMemoryAdultSelfAssertions,
  memoryAdultSelfAssertionStore,
  supabaseAdultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";

const admin = vi.hoisted(() => vi.fn(() => {
  throw new Error("Empty account IDs must not reach the database.");
}));

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requiresSupabaseStore: () => false,
  requireSupabaseAdmin: admin,
}));

beforeEach(() => {
  __resetMemoryAdultSelfAssertions();
  admin.mockClear();
});

afterEach(() => {
  expect(admin).not.toHaveBeenCalled();
});

describe.each([
  ["memory", memoryAdultSelfAssertionStore],
  ["Supabase", supabaseAdultSelfAssertionStore],
] as const)("%s adult assertion account boundary", (_name, store) => {
  it.each(["", " \t\n "])("rejects an empty account ID %j", async (userId) => {
    await expect(store.record(userId)).rejects.toThrow(
      "An account is required to record an assertion.",
    );
    expect(await store.read(userId)).toBeNull();
  });
});
