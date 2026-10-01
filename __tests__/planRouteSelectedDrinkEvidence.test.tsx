import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: () => null }));

import PlanRoute from "@/components/plan/PlanRoute";

const base = { venueId: "venue-a", venueName: "The George", position: 0 };

describe("saved Plan route price display", () => {
  it.each([
    ["wine", 550, "2026-09-25T12:00:00.000Z", "Wine £5.50, community report 25 Sept 2026. Serving size not recorded."],
    ["cocktail", 850, "2026-09-26T12:00:00.000Z", "Cocktails £8.50, community report 26 Sept 2026. Serving size not recorded."],
  ] as const)("names saved %s report and missing serving size", (category, pence, reportedAt, expected) => {
    const html = renderToStaticMarkup(<PlanRoute
      planId="6ab5ca40-836b-4970-9477-d1779fdd31ab"
      startTime="2026-09-30T18:00:00.000Z"
      stops={[{ ...base, selectedDrinkPriceEvidence: {
        category, pence, serving: null, source: "community", reportedAt,
      } }]}
    />);

    expect(html).toContain(expected);
  });

  it("does not invent a selected drink price for an unpriced stop", () => {
    const html = renderToStaticMarkup(<PlanRoute
      planId="6ab5ca40-836b-4970-9477-d1779fdd31ab"
      startTime="2026-09-30T18:00:00.000Z"
      stops={[base]}
    />);

    expect(html).not.toContain("community report");
  });

  it("does not show a malformed stored drink claim", () => {
    const html = renderToStaticMarkup(<PlanRoute
      planId="6ab5ca40-836b-4970-9477-d1779fdd31ab"
      startTime="2026-09-30T18:00:00.000Z"
      stops={[{ ...base, selectedDrinkPriceEvidence: {
        category: "beer", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z",
      } }]}
    />);

    expect(html).not.toContain("community report");
  });
});

describe("single-stop Plan map link", () => {
  it("opens the chosen venue in build mode without requiring a walking route", () => {
    const html = renderToStaticMarkup(<PlanRoute
      planId="6ab5ca40-836b-4970-9477-d1779fdd31ab"
      startTime="2026-09-30T18:00:00.000Z"
      stops={[base]}
    />);

    expect(html).toContain(
      'href="/map?mode=build&amp;pubs=venue-a&amp;sel=venue-a">Open on the map</a>',
    );
    expect(html).not.toContain('class="planRoute__walk"');
  });
});
