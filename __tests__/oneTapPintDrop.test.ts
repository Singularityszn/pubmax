import { beforeEach, describe, expect, it } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  readCommunityPrices,
} from "@/lib/communityPriceStore";
import { writeOneTapPricePair } from "@/lib/oneTapPintDrop.server";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";

beforeEach(() => {
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
});
