import { describe, expect, it } from "vitest";

import { listedServingComparisonKey } from "@/lib/listedPriceComparison";

describe("listed serving comparison", () => {
  it("groups only the same category and explicitly identical measured serve", () => {
    expect(listedServingComparisonKey("wine", "125ml")).toBe("wine:125ml");
    expect(listedServingComparisonKey("wine", "125 ml glass")).toBe("wine:125ml");
    expect(listedServingComparisonKey("wine", "250ml")).toBe("wine:250ml");
    expect(listedServingComparisonKey("gin", "25ml shot")).toBe("gin:25ml");
  });

  it("leaves unknown, bottle, mixed and ambiguous serves incomparable", () => {
    for (const serving of [
      null,
      undefined,
      "",
      "Btl",
      "bottle",
      "750ml bottle",
      "125/250ml",
      "125ml + tonic",
      "single",
      "0ml",
    ]) {
      expect(listedServingComparisonKey("wine", serving)).toBeNull();
    }
  });

  it("does not make beer or unselectable categories part of the drink lens", () => {
    expect(listedServingComparisonKey("beer", "568ml")).toBeNull();
    expect(listedServingComparisonKey("other", "125ml")).toBeNull();
    expect(listedServingComparisonKey("juice", "125ml")).toBeNull();
  });
});
