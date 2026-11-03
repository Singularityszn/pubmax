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

  it("uses the supplied instant and refuses later observations", () => {
    const now = Date.parse("2026-10-02T12:00:00.000Z");
    expect(comparablePint({ ...pint, priceObservedAt: "2026-10-02T11:00:00Z" }, now)).toBe(5);
    expect(comparablePint({ ...pint, priceObservedAt: "2026-10-02T13:00:00Z" }, now)).toBeNull();
    expect(comparablePint({ ...pint, priceObservedAt: "2026-10-03" }, now)).toBeNull();
  });

  it.each(["BOTTLED BEER", "Lager bottle", "330ml Lager", "Lager 50 cl", "Lager 0.5l", "Half pint lager", "Half-pint lager", "half_pint lager", "Half–pint lager", "2 halves of stout", "Lager half", "1/2 Lager", "Lager ⅔", "Third of lager", "Small pint"])("refuses an explicit non-pint serving: %s", (cheapestPint) => {
    expect(comparablePint({ ...pint, cheapestPint })).toBeNull();
  });

  it.each([undefined, "", "Lager", "Other Half Green Diamond", "Half Moon IPA", "Small Beer Lager", "Third Wheel Bitter", "Lager 568 ml", "Lager 0.568l"])("keeps the legacy pint contract for %s", (cheapestPint) => {
    expect(comparablePint({ ...pint, cheapestPint })).toBe(5);
  });
});
