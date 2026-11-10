import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
  moderateCommunityPrice,
  reportCommunityPrice,
  withdrawFailedPairingPrice,
  readCommunityPrices,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  revertOneTapCommunityPricePairing,
  writeOneTapPintDrop,
} from "@/lib/oneTapPintDrop.server";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { PhotoRefusalError, UNREADABLE_PHOTO_REFUSAL } from "@/lib/pintDropsStore";

vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    withdrawFailedPairingPrice: vi.fn(actual.withdrawFailedPairingPrice),
  };
});

// The store stays the real in-memory one until a test scripts a failure, so
// every existing case here keeps exercising the write it was written for.
const storeFailure = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("@/lib/pintDropsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDropsStore")>();
  const store = {
    ...actual.memoryPintDropStore,
    create: async (...args: Parameters<typeof actual.memoryPintDropStore.create>) => {
      if (storeFailure.error) throw storeFailure.error;
      return actual.memoryPintDropStore.create(...args);
    },
  };
  return { ...actual, memoryPintDropStore: store, pintDropsStore: () => store };
});

beforeEach(async () => {
  storeFailure.error = null;
  __resetCommunityPrices();
  __resetPintDrops();
  vi.mocked(withdrawFailedPairingPrice).mockReset();
  const actual = await vi.importActual<typeof import("@/lib/communityPriceStore")>(
    "@/lib/communityPriceStore",
  );
  vi.mocked(withdrawFailedPairingPrice).mockImplementation(actual.withdrawFailedPairingPrice);
});

function observationOf(price: Awaited<ReturnType<typeof submitCommunityPrice>>["price"]) {
  return { id: price!.id!, actor: "profile:test", submittedAt: price!.submittedAt, priceGbp: price!.priceGbp };
}

describe("writeOneTapPintDrop", () => {
  it("creates a visible visit report for a priced pint", async () => {
    const outcome = await writeOneTapPintDrop({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      measure: "pint",
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.drop).toMatchObject({
      venueId: "venue-xjf3n0",
      handle: "karan",
      priceGbp: 4.2,
      drink: submitCategoryLabel("beer"),
      visibility: "public",
    });
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });

  it("refuses to pair a non-beer category into the pint-only drop lane", async () => {
    await expect(
      writeOneTapPintDrop({
        venueId: "venue-xjf3n0",
        handle: "karan",
        drinkCategory: "coffee",
        priceGbp: 2.5,
        measure: "pint",
      }),
    ).rejects.toThrow(/only pairs beer/);
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(0);
  });

  it("binds one-tap price authority to the verified account, not the handle", async () => {
    const outcome = await writeOneTapPintDrop({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      measure: "pint",
      verifiedAccountId: "account-a",
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.drop.authorityKey).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.drop.authorityKey).not.toContain("account-a");
  });

  it("removes a community price when pairing revert runs", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId,
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      contributorHandle: "karan",
    });
    expect(price?.id).toBeTruthy();
    expect(await readCommunityPrices(venueId)).toHaveLength(1);

    expect(await revertOneTapCommunityPricePairing(observationOf(price))).toBe(true);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("leaves a price alone when the stored row is no longer this request's observation", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId,
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      contributorHandle: "karan",
    });
    expect(await revertOneTapCommunityPricePairing({
      id: price!.id!, actor: "profile:test", submittedAt: price!.submittedAt - 60_000, priceGbp: 4.2,
    })).toBe(true);
    expect(await readCommunityPrices(venueId)).toMatchObject([{ priceGbp: 4.2 }]);
  });

  it("preserves a moderator's hide, note and report metadata", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId, drinkCategory: "beer", priceGbp: 4.2, actor: "profile:test",
    });
    await reportCommunityPrice(price!.id!, "Wrong price", "reporter");
    await moderateCommunityPrice(price!.id!, true, "Moderator decision");
    const before = await memoryCommunityPriceStore.listForReview();
    expect(before).toMatchObject([{
      hidden: true, moderatorNote: "Moderator decision", reportCount: 1, reportReason: "Wrong price",
    }]);

    expect(await revertOneTapCommunityPricePairing(observationOf(price))).toBe(true);

    expect(await memoryCommunityPriceStore.listForReview()).toEqual(before);
    expect(await readCommunityPrices(venueId)).toEqual([]);
    await submitCommunityPrice({
      venueId, drinkCategory: "beer", priceGbp: 4.5, actor: "profile:test",
    });
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it.each([
    { delay: 1, priceGbp: 4.2 },
    { delay: 0, priceGbp: 4.5 },
  ])("preserves a later write with delay $delay and price $priceGbp", async ({ delay, priceGbp }) => {
    const venueId = "venue-xjf3n0";
    const input = { venueId, drinkCategory: "beer" as const, priceGbp: 4.2, actor: "profile:test" };
    const now = Date.now();
    const { price } = await submitCommunityPrice(input, now);
    const later = await submitCommunityPrice({ ...input, priceGbp }, now + delay);
    expect(later.price!.id).toBe(price!.id);

    expect(await revertOneTapCommunityPricePairing(observationOf(price))).toBe(true);

    expect(await readCommunityPrices(venueId)).toMatchObject([{ priceGbp, submittedAt: now + delay }]);
    expect(await memoryCommunityPriceStore.listForReview()).toEqual([]);
  });

  it("retries an unavailable withdrawal once", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId,
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      contributorHandle: "karan",
    });
    const actual = await vi.importActual<typeof import("@/lib/communityPriceStore")>(
      "@/lib/communityPriceStore",
    );
    vi.mocked(withdrawFailedPairingPrice)
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockImplementation(actual.withdrawFailedPairingPrice);

    expect(await revertOneTapCommunityPricePairing(observationOf(price))).toBe(true);
    expect(vi.mocked(withdrawFailedPairingPrice)).toHaveBeenCalledTimes(2);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("returns false when withdrawal never lands", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId,
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      contributorHandle: "karan",
    });
    vi.mocked(withdrawFailedPairingPrice).mockResolvedValue({ status: "unavailable" });

    expect(await revertOneTapCommunityPricePairing(observationOf(price))).toBe(false);
    expect(vi.mocked(withdrawFailedPairingPrice)).toHaveBeenCalledTimes(2);
    expect(await readCommunityPrices(venueId)).toHaveLength(1);
  });

  it("creates a matching Pint Drop for each accepted price observation", async () => {
    const input = {
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer" as const,
      priceGbp: 4.2,
      measure: "pint" as const,
    };
    const first = await writeOneTapPintDrop(input);
    expect(first).toMatchObject({ ok: true });

    const second = await writeOneTapPintDrop({ ...input, priceGbp: 4.5 });
    expect(second).toMatchObject({ ok: true });
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(2);
  });
});

// ── A PHOTO WE CANNOT READ IS THE DRINKER'S TO FIX ────────────────────────────
//
// The one-tap door told a refused FILE from a storage outage by the error's
// words ("Photo must…"). The unreadable image is the one refusal whose sentence
// starts differently, so it came back as `storage`: a retryable 503 inviting a
// drinker to send the same bytes again, which can never succeed. The class is
// the answer, not the sentence.
describe("a photo the normaliser cannot open", () => {
  const input = {
    venueId: "venue-xjf3n0",
    handle: "karan",
    drinkCategory: "beer" as const,
    priceGbp: 4.2,
    measure: "pint" as const,
  };

  it("is the drinker's to fix, and says so", async () => {
    storeFailure.error = new PhotoRefusalError(UNREADABLE_PHOTO_REFUSAL);

    const outcome = await writeOneTapPintDrop(input);

    expect(outcome).toEqual({
      ok: false,
      kind: "invalid_photo",
      message: UNREADABLE_PHOTO_REFUSAL,
    });
  });

  it("is still told apart from a storage outage, which is ours", async () => {
    storeFailure.error = new Error("supabase storage exploded");

    const outcome = await writeOneTapPintDrop(input);

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
  });
});
