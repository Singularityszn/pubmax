import { describe, expect, it } from "vitest";

import { comparablePint } from "@/lib/comparablePint.mjs";

describe("comparable pint evidence", () => {
  const pint = { cheapestPrice: 5, priceSource: "Pub menu", priceObservedAt: "2026-01-01" };

  it("accepts a sourced pint and refuses incomplete or non-pint evidence", () => {
    expect(comparablePint(pint)).toBe(5);
    for (const change of [
      { anchorLabel: "Half pint house lager" },
      { priceSource: "" },
      { priceObservedAt: "2026-02-30" },
      { priceObservedAt: "2999-01-01" },
      { priceObservedAt: "2026-01" },
      { measure: "half" },
      { cheapestPrice: 0 },
    ]) {
      expect(comparablePint({ ...pint, ...change })).toBeNull();
    }
  });
});
