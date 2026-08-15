import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PriceContributionImpact from "@/components/map/PriceContributionImpact";

// IntentLink reads the app router to warm its destination on pointer intent.
// A bare static render has no router mounted, so the seam is stubbed here; the
// assertion below is about the rendered anchor, not about the warm.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => undefined,
    }),
  };
});

describe("PriceContributionImpact", () => {
  it("links credited attribution to its encoded anchored public impact", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "credited", handle: "night owl/club" },
    }));

    expect(html).toContain("Counted under");
    expect(html).toContain("@night owl/club");
    expect(html).toContain('href="/u/night%20owl%2Fclub#contribution-impact"');
    expect(html).toContain("See your impact");
  });

  it("renders no profile link for anonymous attribution", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "anonymous" },
    }));

    expect(html).toBe("");
  });

  it("keeps the impact link a client transition so the map survives the tap", () => {
    // A raw <a> here is a full document load of a nonce'd dynamic page: the
    // camera, the filters and the MapLibre instance all go. Pin the source.
    const source = readFileSync(
      new URL("../components/map/PriceContributionImpact.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("IntentLink");
    expect(source).not.toMatch(/<a\s/);
  });
});
