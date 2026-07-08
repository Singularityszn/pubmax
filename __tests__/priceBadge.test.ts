import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";

describe("PriceBadge", () => {
  it("renders stable numeric-data classes without stamp styling", () => {
    const html = renderToStaticMarkup(
      createElement(PriceBadge, { variant: "cheap" }, "£5.50"),
    );

    expect(html).toContain("priceBadge");
    expect(html).toContain("priceBadge--cheap");
    expect(html).toContain("£5.50");
    expect(html).not.toContain("ink-stamp");
    expect(html).not.toContain("priceStamp");
  });
});
