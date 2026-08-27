import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, ensureProfile } = vi.hoisted(() => ({
  rpc: vi.fn(),
  ensureProfile: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => ({ rpc }),
  };
});

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ ensure: ensureProfile }),
}));

import { writeOneTapPricePair } from "@/lib/oneTapPintDrop.server";

beforeEach(() => {
  rpc.mockReset();
  ensureProfile.mockReset();
  ensureProfile.mockResolvedValue(undefined);
});

describe("writeOneTapPricePair Supabase receipt", () => {
  it("sends named RPC arguments and returns the stored winning price", async () => {
    rpc.mockImplementation(async (_name: string, args: { p_drop_id: string }) => ({
      data: [{
        price_id: "00000000-0000-4000-8000-000000000140",
        price_pennies: 510,
        submitted_at: "2026-08-27T20:00:00.000Z",
        drop_id: args.p_drop_id,
      }],
      error: null,
    }));

    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      verifiedAccountId: "account-a",
    });

    expect(rpc).toHaveBeenCalledWith("create_one_tap_price_pair", {
      p_actor: "profile:test",
      p_authority_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_contributor_handle: "karan",
      p_drink: "Beer",
      p_drink_category: "beer",
      p_drop_id: expect.any(String),
      p_handle: "karan",
      p_pint_photo_key: null,
      p_price_pennies: 420,
      p_submitted_at: expect.any(String),
      p_venue_id: "venue-xjf3n0",
      p_venue_photo_key: null,
    });
    expect(outcome).toMatchObject({
      ok: true,
      price: { priceGbp: 5.1, submittedAt: Date.parse("2026-08-27T20:00:00.000Z") },
      drop: { priceGbp: 5.1 },
    });
  });

  it.each([
    ["string pennies", { price_pennies: "510" }],
    ["null pennies", { price_pennies: null }],
    ["invalid timestamp", { submitted_at: "not-a-date" }],
    ["wrong drop", { drop_id: "wrong-drop" }],
    ["missing price id", { price_id: null }],
  ])("refuses a malformed RPC receipt with %s", async (_case, override) => {
    rpc.mockImplementation(async (_name: string, args: { p_drop_id: string }) => ({
      data: [{
        price_id: "00000000-0000-4000-8000-000000000140",
        price_pennies: 510,
        submitted_at: "2026-08-27T20:00:00.000Z",
        drop_id: args.p_drop_id,
        ...override,
      }],
      error: null,
    }));

    await expect(writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
    })).resolves.toMatchObject({ ok: false, kind: "storage" });
  });
});
