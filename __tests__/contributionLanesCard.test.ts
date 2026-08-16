import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributionLanesCard, {
  ContributionLanesCardContent,
  type ContributionLanesCardState,
} from "@/components/profile/ContributionLanesCard";

type CardState = ContributionLanesCardState;

describe("ContributionLanesCard", () => {
  it("exposes one stable impact anchor in loading, degraded, and ready states", () => {
    for (const state of [
      { kind: "loading" },
      { kind: "error" },
      { kind: "ready", stats: { status: "degraded", handle: "night_owl" } },
      {
        kind: "ready",
        stats: { status: "ready", handle: "night_owl", prices: 1 },
      },
    ] satisfies CardState[]) {
      const html = renderToStaticMarkup(createElement(ContributionLanesCardContent, { state }));
      expect(html).toContain('id="contribution-impact"');
      expect(html).toContain("Your contributor record");
    }
  });

  it("renders a price-only ready record instead of the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: {
            status: "ready",
            handle: "night_owl",
            prices: 1,
            reviews: 0,
            recommendations: 0,
          },
        },
      }),
    );

    expect(html).toContain('class="contribStatValue">1</span>');
    expect(html).toContain('class="contribStatLabel">price</span>');
    expect(html).not.toContain("No visit reports or recommendations yet");
  });

  it("uses singular and plural grammar for price records", () => {
    const render = (prices: number) =>
      renderToStaticMarkup(
        createElement(ContributionLanesCardContent, {
          state: {
            kind: "ready",
            stats: { status: "ready", handle: "night_owl", prices },
          },
        }),
      );

    expect(render(1)).toContain('class="contribStatLabel">price</span>');
    expect(render(2)).toContain('class="contribStatLabel">prices</span>');
  });

  it("keeps degraded stats honest without showing zero counts", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: { status: "degraded", handle: "night_owl", prices: 1 },
        },
      }),
    );

    expect(html).toContain("load the rest of your record right now.");
    expect(html).not.toContain(">0<");
    expect(html).not.toContain("1 price");
  });

  it("keeps server loading markup anchored and non-numeric", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCard, { handle: "night_owl" }),
    );

    expect(html).toContain('id="contribution-impact"');
    expect(html).toContain("Your contributor record");
    expect(html).not.toMatch(/\b\d+ prices?\b/);
  });
});
