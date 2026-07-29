import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane, {
  type DealsTonightLaneProps,
} from "@/components/discovery/DealsTonightLane";
import { FEED_FILTERS } from "@/lib/feed";
import type { WhatsOnRow } from "@/lib/whatsOn";

const expensiveExperience: WhatsOnRow = {
  id: "deal-avora",
  placeName: "Avora",
  kind: "deal",
  startsAt: "2026-07-29T19:00:00.000Z",
  title: "Immersive cocktail experience",
  detail: "From £52.50",
  priceGbp: 52.5,
  source: {
    label: "Avora",
    url: "https://example.com/avora",
  },
  observedAt: "2026-07-28T12:00:00.000Z",
  confidence: "listed",
};

describe("production QA destination copy", () => {
  it("presents non-pub experiences as deals without claiming a cheap round", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane as ComponentType<DealsTonightLaneProps>, {
        rows: [expensiveExperience],
        asOf: "2026-07-28T12:00:00.000Z",
      }),
    );

    expect(html).toContain("Deals tonight");
    expect(html).toContain("From £52.50");
    expect(html).not.toMatch(/cheap round/i);
  });

  it("labels the reranked public lane by ranking behaviour, not ownership", () => {
    expect(FEED_FILTERS.find((filter) => filter.id === "for-you")?.label).toBe(
      "Top picks",
    );
  });
});
