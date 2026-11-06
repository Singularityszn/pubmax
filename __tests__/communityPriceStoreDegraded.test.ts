import { beforeEach, describe, expect, it, vi } from "vitest";

const unavailableRead = vi.hoisted(() => vi.fn(async () => ({
  data: null,
  error: { message: "database unavailable" },
})));

vi.mock("@/lib/supabase", () => {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    not: () => query,
    or: () => query,
    order: () => query,
    limit: unavailableRead,
  };
  return {
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => ({ from: () => query }),
  };
});

import {
  listCommunityPricesForReviewWithStatus,
  readCommunityPricesWithStatus,
} from "@/lib/communityPriceStore";

describe("community price degraded reads", () => {
  beforeEach(() => {
    unavailableRead.mockClear();
  });

  it("preserves durable read failure separately from an honest empty", async () => {
    await expect(readCommunityPricesWithStatus("venue-3h52h")).resolves.toEqual({
      prices: [],
      degraded: true,
    });
    expect(unavailableRead).toHaveBeenCalledOnce();
  });

  it("preserves durable review-queue failure separately from an honest empty", async () => {
    await expect(listCommunityPricesForReviewWithStatus()).resolves.toEqual({
      prices: [],
      degraded: true,
    });
    expect(unavailableRead).toHaveBeenCalledOnce();
  });
});
