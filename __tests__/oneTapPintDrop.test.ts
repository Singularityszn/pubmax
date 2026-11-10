import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import { cleanNightMomentDraft } from "@/lib/nightMemory";
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

  it("replays the first figure after a same-millisecond correction and preserves its receipt evidence", async () => {
    const now = Date.now();
    const input = { venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer" as const, priceGbp: 5, measure: "pint" as const };
    const pairing = { actor: "profile:test", submittedAt: now };
    const first = await writeOneTapPintDrop(input, undefined, pairing);
    expect(first).toMatchObject({ ok: true, created: true });
    if (!first.ok) throw new Error("The first pair was not saved.");
    expect(cleanNightMomentDraft({ kind: "pint_drop", pintDropId: first.drop.id })).toMatchObject({
      kind: "pint_drop", pintDropId: first.drop.id,
    });
    expect(dropMemory.grantPintDropReceipt(first.drop.id)).toBe(true);
    const original = structuredClone(listVisiblePintDrops(input.venueId));
    expect(await writeOneTapPintDrop({ ...input, priceGbp: 6 }, undefined, pairing)).toMatchObject({ ok: true, created: true });
    const priceBefore = await readCommunityPrices(input.venueId);
    expect(await writeOneTapPintDrop(input, undefined, pairing)).toMatchObject({
      ok: true, created: false, drop: { id: first.drop.id, priceGbp: 5, priceEvidence: "receipt" },
      price: { id: first.price?.id, priceGbp: 5, submittedAt: now },
    });
    expect(priceBefore).toMatchObject([{ priceGbp: 6 }]);
    expect(listVisiblePintDrops(input.venueId)).toHaveLength(2);
    expect(listVisiblePintDrops(input.venueId)).toEqual(expect.arrayContaining(original));
    expect(await readCommunityPrices(input.venueId)).toEqual(priceBefore);
    expect(await writeOneTapPintDrop({ ...input, priceGbp: 6 }, undefined, { ...pairing, submittedAt: now + 7000 })).toMatchObject({ ok: true, created: true });
    expect(await writeOneTapPintDrop(input, undefined, pairing)).toMatchObject({ ok: false, kind: "superseded" });
    expect(listVisiblePintDrops(input.venueId)).toHaveLength(3);
  });

  it.each([
    { venueId: "another-venue" }, { handle: "another_drinker" }, { priceGbp: 7 }, { measure: "half" as const },
  ])("refuses a conflicting derived id with %j", async (change) => {
    const input = { venueId: "venue-xjf3n0", handle: "karan", drinkCategory: "beer" as const, priceGbp: 5, measure: "pint" as const };
    const pairing = { actor: "profile:test", submittedAt: Date.now() };
    const first = await writeOneTapPintDrop(input, undefined, pairing);
    if (!first.ok) throw new Error("The first pair was not saved.");
    const stored = dropMemory.findPintDropsByIds([first.drop.id]).get(first.drop.id);
    if (!stored) throw new Error("The first drop was not stored.");
    Object.assign(stored, change);
    expect(await writeOneTapPintDrop({ ...input, priceGbp: 6 }, undefined, pairing)).toMatchObject({ ok: true, created: true });
    const priceBefore = await readCommunityPrices(input.venueId);
    const dropsBefore = structuredClone(dropMemory.findPintDropsByIds([first.drop.id]));
    expect(await writeOneTapPintDrop(input, undefined, pairing)).toMatchObject({ ok: false, kind: "storage" });
    expect(await readCommunityPrices(input.venueId)).toEqual(priceBefore);
    expect(dropMemory.findPintDropsByIds([first.drop.id])).toEqual(dropsBefore);
    expect(listVisiblePintDrops(input.venueId)).toHaveLength(2);
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
