import { beforeEach, describe, expect, it, vi } from "vitest";

const durable = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase", async () => {
  const { billTable } = await import("@/__tests__/helpers/billTable");
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ from: () => billTable(durable.rows) }),
  };
});

import { moderateCommunityPriceWithState } from "@/lib/communityPriceStore";

const submittedAt = Date.parse("2026-11-05T19:30:00.000Z");
const observation = (overrides: Record<string, unknown> = {}) => ({
  id: "price-1", drink_category: "beer", submitted_at: new Date(submittedAt).toISOString(),
  price_pennies: 450, round_spend_id: null, round_line_index: null, hidden_at: null,
  ...overrides,
});
const expected = { submittedAt, priceGbp: 4.5 };

describe("durable community observation moderation", () => {
  beforeEach(() => { durable.rows = []; });

  it.each([true, false])("changes only the checked ordinary observation when hidden=%s", async (hidden) => {
    const checked = observation({ hidden_at: hidden ? null : "2026-11-05T20:00:00.000Z" });
    const others = [
      observation({ id: "price-2" }),
      observation({ submitted_at: "2026-11-05T20:30:00.000Z" }),
      observation({ price_pennies: 620 }),
      observation({ round_spend_id: "spend-1" }),
      observation({ round_line_index: 0 }),
    ];
    const before = structuredClone(others);
    durable.rows = [checked, ...others];
    expect(await moderateCommunityPriceWithState("price-1", hidden, "Bill mismatch", expected))
      .toEqual({ status: "ok", changed: true, kind: "price" });
    expect(checked.hidden_at).toEqual(hidden ? expect.any(String) : null);
    expect(checked).toMatchObject({ moderator_note: "Bill mismatch", moderated_at: expect.any(String) });
    expect(others).toEqual(before);
    expect(await moderateCommunityPriceWithState("price-1", hidden, "Bill mismatch", expected))
      .toEqual({ status: "ok", changed: false, kind: "price" });
  });

  it.each([true, false])("changes only the promoted Round source when hidden=%s", async (hidden) => {
    const source = { round_spend_id: "spend-1", round_line_index: 1 };
    const checked = observation({ ...source, hidden_at: hidden ? null : "2026-11-05T20:00:00.000Z" });
    const others = [
      observation({ ...source, id: "price-2" }),
      observation({ ...source, submitted_at: "2026-11-05T20:30:00.000Z" }),
      observation({ ...source, price_pennies: 620 }),
      observation({ ...source, round_spend_id: "spend-2" }),
      observation({ ...source, round_line_index: 0 }),
      observation(),
    ];
    const before = structuredClone(others);
    durable.rows = [checked, ...others];
    expect(await moderateCommunityPriceWithState("price-1", hidden, "Bill mismatch", {
      ...expected, roundSource: { spendId: "spend-1", lineIndex: 1 },
    })).toEqual({ status: "ok", changed: true, kind: "price" });
    expect(checked.hidden_at).toEqual(hidden ? expect.any(String) : null);
    expect(others).toEqual(before);
  });

  it("returns the Venue signal kind on a change and an unchanged retry", async () => {
    const signal = observation({ id: "signal-1", drink_category: null });
    durable.rows = [signal];
    expect(await moderateCommunityPriceWithState("signal-1", true))
      .toEqual({ status: "ok", changed: true, kind: "signal" });
    expect(signal.hidden_at).toEqual(expect.any(String));
    expect(await moderateCommunityPriceWithState("signal-1", true))
      .toEqual({ status: "ok", changed: false, kind: "signal" });
  });

  it("identifies an already-hidden checked observation so trust reconciliation can resume", async () => {
    const checked = observation({ hidden_at: "2026-11-05T20:00:00.000Z" });
    const before = { ...checked };
    durable.rows = [checked];
    expect(await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", expected))
      .toEqual({ status: "ok", changed: false, kind: "price" });
    expect(checked).toEqual(before);
  });

  it.each([
    { submitted_at: "2026-11-05T20:30:00.000Z" },
    { price_pennies: 620 },
    { round_spend_id: "spend-2", round_line_index: 0 },
    { round_spend_id: "spend-1", round_line_index: 1 },
  ])("preserves a replacement observation instead of hiding the checked price: %j", async (correction) => {
    const replacement = observation({ round_spend_id: "spend-1", round_line_index: 0, ...correction });
    const before = { ...replacement };
    durable.rows = [replacement];
    expect(await moderateCommunityPriceWithState("price-1", true, "Bill mismatch", {
      ...expected, roundSource: { spendId: "spend-1", lineIndex: 0 },
    })).toEqual({ status: "ok", changed: false });
    expect(replacement).toEqual(before);
  });
});
