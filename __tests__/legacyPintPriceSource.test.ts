import { describe, expect, it } from "vitest";

import { namedLegacyPintPriceSource as compatibilityPublisher } from "@/lib/drinks";
import { namedLegacyPintPriceSource } from "@/lib/legacyPintPriceSource";

describe("namedLegacyPintPriceSource", () => {
  it("keeps the drinks compatibility export identical to the focused leaf", () => {
    expect(compatibilityPublisher).toBe(namedLegacyPintPriceSource);
  });

  it("accepts trimmed HTTP sources and preserves publisher labels", () => {
    expect(
      namedLegacyPintPriceSource({ pub_url: " https://www.pint-prices.com/pub/test " }),
    ).toEqual({
      label: "Pint Prices",
      url: "https://www.pint-prices.com/pub/test",
    });
    expect(namedLegacyPintPriceSource({ pub_url: "https://venue.example/menu" })).toEqual({
      label: "venue.example",
      url: "https://venue.example/menu",
    });
  });

  it("rejects missing and non-HTTP publisher sources", () => {
    expect(namedLegacyPintPriceSource({})).toBeNull();
    expect(namedLegacyPintPriceSource({ pub_url: "javascript:alert(1)" })).toBeNull();
  });
});
