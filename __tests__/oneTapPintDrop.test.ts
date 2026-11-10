import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
  moderateCommunityPrice,
  reportCommunityPrice,
  readCommunityPrices,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  writeOneTapPintDrop,
} from "@/lib/oneTapPintDrop.server";
import * as dropMemory from "@/lib/pintDrops";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { PhotoRefusalError, UNREADABLE_PHOTO_REFUSAL } from "@/lib/pintDropsStore";

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
});

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

  it("commits both records with the request figure", async () => {
    const now = Date.now();
    const outcome = await writeOneTapPintDrop({
      venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer",
      priceGbp: 4.2, measure: "pint",
    }, undefined, { actor: "profile:test", submittedAt: now });
    expect(outcome).toMatchObject({ ok: true, created: true, price: { priceGbp: 4.2, submittedAt: now } });
    expect(await readCommunityPrices("venue-xjf3n0")).toMatchObject([{ priceGbp: 4.2 }]);
    expect(listVisiblePintDrops("venue-xjf3n0")).toMatchObject([{ priceGbp: 4.2, measure: "pint", priceEvidence: "unchecked" }]);
  });

  it("leaves no observation when drop persistence fails inside the memory pair", async () => {
    const persist = vi.spyOn(dropMemory, "addPintDrop").mockImplementationOnce(() => {
      throw new Error("Drop persistence failed");
    });
    try {
      const outcome = await writeOneTapPintDrop({
        venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer", priceGbp: 4.2, measure: "pint",
      }, undefined, { actor: "profile:test", submittedAt: Date.now() });
      expect(outcome).toMatchObject({ ok: false, kind: "storage" });
      expect(await readCommunityPrices("venue-xjf3n0")).toEqual([]);
      expect(listVisiblePintDrops("venue-xjf3n0")).toEqual([]);
    } finally {
      persist.mockRestore();
    }
  });

  it("refuses an older request without minting a drop from the newer price", async () => {
    const now = Date.now();
    await submitCommunityPrice({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 8, actor: "profile:test" }, now + 1000);
    const outcome = await writeOneTapPintDrop({
      venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer", priceGbp: 5, measure: "pint",
    }, undefined, { actor: "profile:test", submittedAt: now });
    expect(outcome).toMatchObject({ ok: false, kind: "superseded" });
    expect(await readCommunityPrices("venue-xjf3n0")).toMatchObject([{ priceGbp: 8 }]);
    expect(listVisiblePintDrops("venue-xjf3n0")).toEqual([]);
  });

  it("preserves a moderator's hide, note and reports when pairing fails", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({ venueId, drinkCategory: "beer", priceGbp: 4.2, actor: "profile:test" });
    await reportCommunityPrice(price!.id!, "Wrong price", "reporter");
    await moderateCommunityPrice(price!.id!, true, "Moderator decision");
    const before = await memoryCommunityPriceStore.listForReview();
    storeFailure.error = new PhotoRefusalError(UNREADABLE_PHOTO_REFUSAL);
    const outcome = await writeOneTapPintDrop({
      venueId, handle: "karan", drinkCategory: "beer", priceGbp: 4.5, measure: "pint",
    }, undefined, { actor: "profile:test", submittedAt: Date.now() });
    expect(outcome).toMatchObject({ ok: false, kind: "invalid_photo" });
    expect(await memoryCommunityPriceStore.listForReview()).toEqual(before);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("leaves a successful same-millisecond pair intact when another photo fails", async () => {
    const now = Date.now();
    const input = { venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer" as const, priceGbp: 4.2, measure: "pint" as const };
    expect(await writeOneTapPintDrop(input, undefined, { actor: "profile:test", submittedAt: now })).toMatchObject({ ok: true });
    storeFailure.error = new PhotoRefusalError(UNREADABLE_PHOTO_REFUSAL);
    expect(await writeOneTapPintDrop(input, undefined, { actor: "profile:test", submittedAt: now })).toMatchObject({ ok: false });
    expect(await readCommunityPrices(input.venueId)).toMatchObject([{ priceGbp: 4.2 }]);
    expect(listVisiblePintDrops(input.venueId)).toHaveLength(1);
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
