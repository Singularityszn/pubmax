import { beforeEach, describe, expect, it } from "vitest";

import { submitCategoryLabel } from "@/lib/communityPrice";
import { writeOneTapPintDrop } from "@/lib/oneTapPintDrop.server";
import { __resetPintDrops, listVisiblePintDrops } from "@/lib/pintDrops";

beforeEach(() => {
  __resetPintDrops();
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
