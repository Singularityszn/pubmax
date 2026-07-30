import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane, {
  type DealsTonightLaneProps,
} from "@/components/discovery/DealsTonightLane";
import { londonServiceDayBounds } from "@/lib/whatsOn";

const DEAL_QUALIFIER =
  "Two pints for £12 before 7pm on Thursdays. Booking excludes match nights, bank holidays, and the terrace.";

describe("DealsTonightLane caption", () => {
  it("renders a legitimate deal condition without changing its text", () => {
    const now = Date.now();
    const serviceWindow = londonServiceDayBounds(now);
    const startsAt = new Date(
      Date.parse(serviceWindow.start) + 2 * 60 * 60 * 1000,
    ).toISOString();
    const endsAt = new Date(
      Date.parse(serviceWindow.start) + 4 * 60 * 60 * 1000,
    ).toISOString();
    const observedAt = new Date(now - 60 * 60 * 1000).toISOString();

    const props: DealsTonightLaneProps = {
      asOf: observedAt,
      rows: [
        {
          id: "caption-integrity-deal",
          venueId: "venue-xjf3n0",
          placeName: "Arnos Arms, Arnos Grove",
          kind: "deal",
          startsAt,
          endsAt,
          title: "Early round offer",
          detail: DEAL_QUALIFIER,
          source: { label: "Venue listing", url: "https://example.com/deal" },
          observedAt,
          confidence: "listed",
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(
        DealsTonightLane as ComponentType<DealsTonightLaneProps>,
        props,
      ),
    );

    expect(html).toContain(`class="dealsTonightDetail">${DEAL_QUALIFIER}</span>`);
  });
});
