import { beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({
  changed: true,
  selects: [] as string[],
  filters: [] as Array<[string, unknown]>,
  row: { id: "signal-1", drink_category: null } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase", () => {
  const signalRow = { id: "signal-1", drink_category: null };
  const query = {
    update: () => query,
    select: (columns: string) => {
      durable.selects.push(columns);
      return query;
    },
    eq: (column: string, value: unknown) => {
      durable.filters.push([column, value]);
      return query;
    },
    is: (column: string, value: unknown) => {
      if (column !== "hidden_at") durable.filters.push([column, value]);
      return query;
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: durable.changed ? [signalRow] : [], error: null,
    }).then(resolve),
    not: async () => ({
      data: durable.changed ? [signalRow] : [],
      error: null,
    }),
    limit: async () => ({ data: [durable.row], error: null }),
  };
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => query }),
  };
});

import { moderateCommunityPriceWithState } from "@/lib/communityPriceStore";

describe("durable community observation moderation", () => {
  beforeEach(() => {
    durable.changed = true;
    durable.selects = [];
    durable.filters = [];
    durable.row = { id: "signal-1", drink_category: null };
  });

  it("limits a bill moderation write to its submitted date and price", async () => {
    await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", { submittedAt: 1_793_900_000_000, priceGbp: 4.5 });
    expect(durable.filters).toEqual([
      ["id", "price-1"],
      ["submitted_at", new Date(1_793_900_000_000).toISOString()],
      ["price_pennies", 450],
      ["round_spend_id", null],
      ["round_line_index", null],
    ]);
  });

  it("limits a Round bill hide to the promoted source line", async () => {
    await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", {
      submittedAt: 1_793_900_000_000, priceGbp: 4.5, roundSource: { spendId: "spend-1", lineIndex: 1 },
    });
    expect(durable.filters).toContainEqual(["round_spend_id", "spend-1"]);
    expect(durable.filters).toContainEqual(["round_line_index", 1]);
  });

  it("returns the Venue signal kind when moderation changes the row", async () => {
    await expect(
      moderateCommunityPriceWithState("signal-1", true),
    ).resolves.toEqual({
      status: "ok",
      changed: true,
      kind: "signal",
    });
    expect(durable.selects).toEqual(["id, drink_category"]);
  });

  it("returns the Venue signal kind for an unchanged retry", async () => {
    durable.changed = false;

    await expect(
      moderateCommunityPriceWithState("signal-1", true),
    ).resolves.toEqual({
      status: "ok",
      changed: false,
      kind: "signal",
    });
    expect(durable.selects).toEqual([
      "id, drink_category",
      "id, drink_category, submitted_at, price_pennies, round_spend_id, round_line_index",
    ]);
  });

  it("identifies an already-hidden checked observation so trust reconciliation can resume", async () => {
    durable.changed = false;
    durable.row = {
      id: "price-1", drink_category: "beer", submitted_at: "2026-11-05T19:30:00.000Z",
      price_pennies: 450, round_spend_id: null, round_line_index: null,
    };
    expect(await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", {
      submittedAt: Date.parse("2026-11-05T19:30:00.000Z"), priceGbp: 4.5,
    })).toEqual({ status: "ok", changed: false, kind: "price" });
  });

  it.each([
    { submitted_at: "2026-11-05T20:30:00.000Z" },
    { price_pennies: 620 },
    { round_spend_id: "spend-2", round_line_index: 0 },
    { round_spend_id: "spend-1", round_line_index: 1 },
  ])("does not identify a replacement observation as the checked price: %j", async (correction) => {
    durable.changed = false;
    durable.row = {
      id: "price-1", drink_category: "beer", submitted_at: "2026-11-05T19:30:00.000Z",
      price_pennies: 450, round_spend_id: "spend-1", round_line_index: 0, ...correction,
    };
    expect(await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", {
      submittedAt: Date.parse("2026-11-05T19:30:00.000Z"), priceGbp: 4.5,
      roundSource: { spendId: "spend-1", lineIndex: 0 },
    })).toEqual({ status: "ok", changed: false });
  });
});
