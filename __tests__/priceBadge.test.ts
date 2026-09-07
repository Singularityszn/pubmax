import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";

describe("PriceBadge", () => {
  it.each(["baseline", "current", "cheap", "increase", "neutral"] as const)(
    "renders the shared price face for %s prices",
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(PriceBadge, { variant }, "£5.50"),
      );

      expect(html).toContain("priceBadge");
      expect(html).toContain(`priceBadge--${variant}`);
      expect(html).toContain("price-plaque");
      // The engraved plate is retired (captain 6 Sep 2026). A price wears the
      // plaque and nothing else, so neither ink-stamp class may come back.
      expect(html).not.toContain("ink-stamp");
      expect(html).toContain("£5.50");
      expect(html).not.toContain("priceStamp");
    },
  );

  it("preserves a consumer layout class without replacing the signature", () => {
    const html = renderToStaticMarkup(
      createElement(
        PriceBadge,
        { variant: "current", className: "feedSpillPrice" },
        "£5.50",
      ),
    );

    expect(html).toContain("price-plaque");
    expect(html).toContain("feedSpillPrice");
  });
});
