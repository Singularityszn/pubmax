import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc }),
}));

import { supabaseCommunityPriceStore } from "@/lib/communityPriceStore";

const input = { venueId: "pub", drinkCategory: "coffee" as const, priceGbp: 3, actor: "actor" };
const saved = { id: "observation", price_pennies: 300, submitted_at: "2026-09-07T18:00:00Z" };

beforeEach(() => rpc.mockReset());

describe("durable community receipt contract", () => {
  it("refuses an unattributed receipt instead of dropping its key on insert", async () => {
    expect(await supabaseCommunityPriceStore.submit({ ...input, actor: undefined, receiptPhotoKey: "bill" })).toEqual({ price: null });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the key in the price RPC and preserves its explicit write result", async () => {
    rpc.mockResolvedValue({ data: [{ ...saved, write_applied: true,
      receipt_photo_key: "pub/new/receipt.jpg", replaced_receipt_photo_key: "pub/old/receipt.jpg" }], error: null });
    const result = await supabaseCommunityPriceStore.submit({ ...input, receiptPhotoKey: "pub/new/receipt.jpg" });
    expect(rpc).toHaveBeenCalledWith("upsert_attributed_community_price_if_newer", expect.objectContaining({
      p_price_pennies: 300, p_receipt_photo_key: "pub/new/receipt.jpg", p_actor: "actor",
    }));
    expect(result.receiptWrite).toEqual({ applied: true, key: "pub/new/receipt.jpg", replacedKey: "pub/old/receipt.jpg" });
    expect(result.price).not.toHaveProperty("receiptPhotoKey");
  });

  it("does not infer acceptance from a kept price or Round ownership flag", async () => {
    rpc.mockResolvedValue({ data: [{ ...saved, price_pennies: 400, source_became_owner: true,
      write_applied: false, receipt_photo_key: "pub/newer/receipt.jpg", replaced_receipt_photo_key: null }], error: null });
    const result = await supabaseCommunityPriceStore.submit({ ...input, receiptPhotoKey: "pub/stale/receipt.jpg" });
    expect(result.price?.priceGbp).toBe(4);
    expect(result.receiptWrite).toEqual({ applied: false, key: "pub/newer/receipt.jpg", replacedKey: null });
  });

  it("keeps eight-argument calls and treats an older RPC answer as unproven", async () => {
    rpc.mockResolvedValue({ data: [saved], error: null });
    const result = await supabaseCommunityPriceStore.submit(input);
    expect(Object.keys(rpc.mock.calls[0][1])).toHaveLength(8);
    expect(result.price?.priceGbp).toBe(3);
    expect(result.receiptWrite).toBeUndefined();
  });

  it("does not report a stored receipt after an uncertain RPC failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "response unavailable" } });
    const result = await supabaseCommunityPriceStore.submit({ ...input, receiptPhotoKey: "pub/unknown/receipt.jpg" });
    expect(result.failed).toBe(true);
    expect(result.receiptWrite).toBeUndefined();
  });
});
