import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceContributionImpact from "@/components/map/PriceContributionImpact";

describe("PriceContributionImpact", () => {
  it("links credited attribution to its public impact", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "credited", handle: "night_owl" },
    }));

    expect(html).toContain("Counted under");
    expect(html).toContain("@night_owl");
    expect(html).toContain('href="/u/night_owl"');
    expect(html).toContain("See your impact");
  });

  it("renders no profile link for anonymous attribution", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "anonymous" },
    }));

    expect(html).toBe("");
  });
});
