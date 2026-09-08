import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pintDropsStore", () => ({ deletePhotos: remove }));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({ rpc }),
}));

import { supabaseCommunityPriceStore, submitCommunityPrice } from "@/lib/communityPriceStore";

const input = { venueId: "pub", drinkCategory: "coffee" as const, priceGbp: 3, actor: "actor" };
const saved = { id: "observation", price_pennies: 300, submitted_at: "2026-09-07T18:00:00Z" };

beforeEach(() => { rpc.mockReset(); remove.mockReset(); remove.mockResolvedValue(undefined); });

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


describe("community receipt replacement cleanup", () => {
  it.each([undefined, "pub/new/receipt.jpg"])("cleans the replaced receipt for a caller using key %s", async (receiptPhotoKey) => {
    rpc.mockResolvedValue({ data: [{ ...saved, write_applied: true,
      receipt_photo_key: receiptPhotoKey ?? null, replaced_receipt_photo_key: "pub/old/receipt.jpg" }], error: null });
    await submitCommunityPrice({ ...input, ...(receiptPhotoKey ? { receiptPhotoKey } : {}) });
    expect(remove).toHaveBeenCalledExactlyOnceWith(["pub/old/receipt.jpg"]);
    expect(Object.keys(rpc.mock.calls[0][1])).toHaveLength(receiptPhotoKey ? 9 : 8);
  });

  it.each([
    { ...saved },
    { ...saved, write_applied: true, replaced_receipt_photo_key: "pub/old/receipt.jpg" },
    { ...saved, write_applied: false, receipt_photo_key: "pub/kept/receipt.jpg", replaced_receipt_photo_key: null },
    { ...saved, write_applied: true, receipt_photo_key: "pub/kept/receipt.jpg", replaced_receipt_photo_key: "pub/kept/receipt.jpg" },
  ])("retains photos when no distinct replaced key is proved", async (row) => {
    rpc.mockResolvedValue({ data: [row], error: null });
    await submitCommunityPrice(input);
    expect(remove).not.toHaveBeenCalled();
  });
});


it("retains receipt objects when the accepted key contradicts the submitted key", async () => {
  rpc.mockResolvedValue({ data: [{ ...saved, write_applied: true,
    receipt_photo_key: null, replaced_receipt_photo_key: "pub/old/receipt.jpg" }], error: null });
  await submitCommunityPrice({ ...input, receiptPhotoKey: "pub/new/receipt.jpg" });
  expect(remove).not.toHaveBeenCalled();
});

it("cleans the receipt displaced by an eight-argument Round promotion", async () => {
  rpc.mockResolvedValue({ data: [{ ...saved, write_applied: true, source_became_owner: true,
    receipt_photo_key: null, replaced_receipt_photo_key: "pub/old/receipt.jpg" }], error: null });
  const result = await submitCommunityPrice({ ...input, roundSource: { spendId: "round-spend", lineIndex: 0 } });
  expect(result.sourceBecameOwner).toBe(true);
  expect(Object.keys(rpc.mock.calls[0][1])).toHaveLength(8);
  expect(remove).toHaveBeenCalledExactlyOnceWith(["pub/old/receipt.jpg"]);
});
