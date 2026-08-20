import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import {
  __resetCommunityPrices,
  moderateCommunityPrice,
  readCommunityPrices,
  submitCommunityPrice,
} from "@/lib/communityPriceStore";
import {
  revertOneTapCommunityPricePairing,
  writeOneTapPintDrop,
} from "@/lib/oneTapPintDrop.server";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";

vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    moderateCommunityPrice: vi.fn(actual.moderateCommunityPrice),
  };
});

beforeEach(async () => {
  __resetCommunityPrices();
  __resetPintDrops();
  vi.mocked(moderateCommunityPrice).mockReset();
  const actual = await vi.importActual<typeof import("@/lib/communityPriceStore")>(
    "@/lib/communityPriceStore",
  );
  vi.mocked(moderateCommunityPrice).mockImplementation(actual.moderateCommunityPrice);
});

describe("writeOneTapPintDrop", () => {
  it("creates a visible visit report for a priced pint", async () => {
    const outcome = await writeOneTapPintDrop({
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer",
      priceGbp: 4.2,
    });

    expect(outcome).toMatchObject({ ok: true, skipped: false });
    if (!outcome.ok || outcome.skipped) return;
    expect(outcome.drop).toMatchObject({
      venueId: "venue-xjf3n0",
      handle: "karan",
      priceGbp: 4.2,
      drink: submitCategoryLabel("beer"),
      visibility: "public",
    });
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });

  it("hides a community price when pairing revert runs", async () => {
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

    expect(await revertOneTapCommunityPricePairing(price!.id)).toBe(true);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("retries hide when moderate returns false once", async () => {
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
    vi.mocked(moderateCommunityPrice)
      .mockResolvedValueOnce(false)
      .mockImplementation(actual.moderateCommunityPrice);

    expect(await revertOneTapCommunityPricePairing(price!.id)).toBe(true);
    expect(vi.mocked(moderateCommunityPrice)).toHaveBeenCalledTimes(2);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("returns false when hide never lands", async () => {
    const venueId = "venue-xjf3n0";
    const { price } = await submitCommunityPrice({
      venueId,
      drinkCategory: "beer",
      priceGbp: 4.2,
      actor: "profile:test",
      contributorHandle: "karan",
    });
    vi.mocked(moderateCommunityPrice).mockResolvedValue(false);

    expect(await revertOneTapCommunityPricePairing(price!.id)).toBe(false);
    expect(vi.mocked(moderateCommunityPrice)).toHaveBeenCalledTimes(2);
    expect(await readCommunityPrices(venueId)).toHaveLength(1);
  });

  it("skips a second visit report for the same pub on the same day", async () => {
    const input = {
      venueId: "venue-xjf3n0",
      handle: "karan",
      drinkCategory: "beer" as const,
      priceGbp: 4.2,
    };
    const first = await writeOneTapPintDrop(input);
    expect(first).toMatchObject({ ok: true, skipped: false });

    const second = await writeOneTapPintDrop({ ...input, priceGbp: 4.5 });
    expect(second).toEqual({ ok: true, skipped: true });
    expect(listVisiblePintDrops("venue-xjf3n0")).toHaveLength(1);
  });
});
