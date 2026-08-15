import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributionImpactLink from "@/components/profile/ContributionImpactLink";
import YourContributionsCard from "@/components/profile/YourContributionsCard";

describe("contribution impact return", () => {
  it("links a credited handle to its own contribution card", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionImpactLink, { handle: "night_owl" }),
    );

    expect(html).toContain('href="/u/night_owl#your-contributions"');
    expect(html).toContain("See your impact");
  });

  it("keeps the contribution destination stable while stats load", () => {
    const html = renderToStaticMarkup(
      createElement(YourContributionsCard, { handle: "night_owl" }),
    );

    expect(html).toContain('id="your-contributions"');
    expect(html).toContain('aria-busy="true"');
  });
});
