import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  readCommunityPrices,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import { writeOneTapPricePair } from "@/lib/oneTapPintDrop.server";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { memoryPintDropPairWriter } from "@/lib/pintDropsStore";

beforeEach(() => {
  vi.restoreAllMocks();
  __resetCommunityPrices();
  __resetPintDrops();
});

describe("writeOneTapPricePair", () => {
  it("creates a visible Pint Drop for a priced pint", async () => {
    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
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

  it("creates the Community Price and Pint Drop as one pair", async () => {
    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      verifiedAccountId: "account-a",
    });

    expect(outcome).toMatchObject({ ok: true, price: { priceGbp: 4.2 } });
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(1);
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });

  it("removes the memory Community Price when its Pint Drop fails", async () => {
    vi.spyOn(memoryPintDropPairWriter, "create").mockImplementationOnce(() => {
      throw new Error("forced Pint Drop failure");
    });

    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
    });

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
    expect(await readCommunityPrices("venue-xjf3n0")).toHaveLength(0);
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(0);
  });

  it("binds one-tap price authority to the verified account, not the handle", async () => {
    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      verifiedAccountId: "account-a",
    });

    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.drop.authorityKey).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.drop.authorityKey).not.toContain("account-a");
  });

  it("creates a matching Pint Drop for each accepted price observation", async () => {
    const input = {
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer" as const,
      priceGbp: 4.2,
      actor: "profile:test",
    };
    const first = await writeOneTapPricePair(input);
    expect(first).toMatchObject({ ok: true });

    const second = await writeOneTapPricePair({ ...input, priceGbp: 4.5 });
    expect(second).toMatchObject({ ok: true });
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(2);
  });

  it("uses the stored memory price when an older observation loses ownership", async () => {
    await submitCommunityPrice({
      venueId: "venue-xjf3n0",
      drinkCategory: "beer",
      priceGbp: 5.1,
      actor: "profile:test",
      contributorHandle: "karan",
    }, Date.now() + 60_000);

    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
    });

    expect(outcome).toMatchObject({
      ok: true,
      price: { priceGbp: 5.1 },
      drop: { priceGbp: 5.1 },
    });
  });

  it("preserves an existing memory price when the paired Pint Drop fails", async () => {
    await submitCommunityPrice({
      venueId: "venue-xjf3n0",
      drinkCategory: "beer",
      priceGbp: 5.1,
      actor: "profile:test",
      contributorHandle: "karan",
    }, Date.now() + 60_000);
    vi.spyOn(memoryPintDropPairWriter, "create").mockImplementationOnce(() => {
      throw new Error("forced Pint Drop failure");
    });

    const outcome = await writeOneTapPricePair({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
    });

    expect(outcome).toMatchObject({ ok: false, kind: "storage" });
    expect(await readCommunityPrices("venue-xjf3n0")).toMatchObject([
      { priceGbp: 5.1 },
    ]);
  });

  it("keeps an equal concurrent memory pair when the other write fails", async () => {
    const create = memoryPintDropPairWriter.create.bind(memoryPintDropPairWriter);
    vi.spyOn(memoryPintDropPairWriter, "create")
      .mockImplementationOnce(() => {
        throw new Error("forced Pint Drop failure");
      })
      .mockImplementation(create);
    const input = {
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer" as const,
      priceGbp: 4.2,
      actor: "profile:test",
    };

    const [failed, saved] = await Promise.all([
      writeOneTapPricePair(input),
      writeOneTapPricePair(input),
    ]);

    expect(failed).toMatchObject({ ok: false, kind: "storage" });
    expect(saved).toMatchObject({ ok: true, price: { priceGbp: 4.2 } });
    expect(await readCommunityPrices("venue-xjf3n0")).toMatchObject([
      { priceGbp: 4.2 },
    ]);
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });
});
