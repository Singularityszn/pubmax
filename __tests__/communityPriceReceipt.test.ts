import { beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
const writes = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/pintDropsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDropsStore")>();
  return { ...actual, uploadPhoto: media.upload, deletePhotos: media.remove };
});
vi.mock("@/lib/communityPriceStore", () => ({ submitCommunityPrice: writes.submit }));

import { PhotoRefusalError } from "@/lib/pintDropsStore";
import { submitCommunityPriceWithReceipt } from "@/lib/communityPriceReceipt.server";

const input = { venueId: "pub", drinkCategory: "coffee" as const, priceGbp: 3, actor: "owner" };
const file = new File(["fixture"], "bill.jpg", { type: "image/jpeg" });
const candidateKey = "pub/candidate/receipt.jpg";

beforeEach(() => {
  vi.resetAllMocks();
  media.upload.mockResolvedValue(candidateKey);
  media.remove.mockResolvedValue(undefined);
});

describe("community price receipt attachment", () => {
  it("requires an actor before uploading a bill", async () => {
    await expect(submitCommunityPriceWithReceipt({ ...input, actor: "" }, file)).rejects.toThrow("attributed price");
    expect(media.upload).not.toHaveBeenCalled();
    expect(writes.submit).not.toHaveBeenCalled();
  });
  it("sends price and key together through the shared replacement writer", async () => {
    writes.submit.mockResolvedValue({
      price: { priceGbp: 3 },
      receiptWrite: { applied: true, key: candidateKey, replacedKey: "pub/old/receipt.jpg" },
    });
    const result = await submitCommunityPriceWithReceipt(input, file, 1234);
    expect(media.upload).toHaveBeenCalledWith("receipt", "pub", expect.any(String), file);
    expect(writes.submit).toHaveBeenCalledWith({ ...input, receiptPhotoKey: candidateKey }, 1234);
    expect(result.receiptStatus).toBe("stored");
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("cleans only the unused candidate when a newer observation wins", async () => {
    writes.submit.mockResolvedValue({
      price: { priceGbp: 4 },
      receiptWrite: { applied: false, key: "pub/newer/receipt.jpg", replacedKey: null },
    });
    const result = await submitCommunityPriceWithReceipt(input, file);
    expect(result.receiptStatus).toBe("superseded");
    expect(result.price?.priceGbp).toBe(4);
    expect(media.remove).toHaveBeenCalledExactlyOnceWith([candidateKey]);
  });

  it.each([
    { price: null, failed: true },
    { price: { priceGbp: 3 } },
    { price: { priceGbp: 3 }, receiptWrite: { applied: true, key: null, replacedKey: null } },
  ])("retains the object when the write result cannot prove attachment", async (reply) => {
    writes.submit.mockResolvedValue(reply);
    const result = await submitCommunityPriceWithReceipt(input, file);
    expect(result.receiptStatus).toBe("unavailable");
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("retains a potentially committed receipt when the response is lost", async () => {
    writes.submit.mockRejectedValue(new Error("response lost after commit"));
    await expect(submitCommunityPriceWithReceipt(input, file)).rejects.toThrow("response lost");
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("does not write a price when image preparation refuses its bytes", async () => {
    media.upload.mockRejectedValue(new PhotoRefusalError("invalid image"));
    await expect(submitCommunityPriceWithReceipt(input, file)).rejects.toThrow("invalid image");
    expect(writes.submit).not.toHaveBeenCalled();
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("does not delete a candidate the store already references", async () => {
    writes.submit.mockResolvedValue({
      price: { priceGbp: 3 },
      receiptWrite: { applied: false, key: candidateKey, replacedKey: null },
    });
    expect((await submitCommunityPriceWithReceipt(input, file)).receiptStatus).toBe("stored");
    expect(media.remove).not.toHaveBeenCalled();
  });
});
