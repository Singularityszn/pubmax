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


describe("real saved Cider PlanRoute public map links", () => {
  it.each([null, "pint", "500ml"])("serializes whole-route and per-stop Cider intent with %s", async (drinkServing) => {
    const { routeDrinkIntentFromSearch } = await import("@/lib/crawlUrl");
    const stops = [base, { venueId: "venue-b", venueName: "The Swan", position: 1 }];
    const html = renderToStaticMarkup(<PlanRoute
      planId="6ab5ca40-836b-4970-9477-d1779fdd31ab"
      startTime="2026-09-30T18:00:00.000Z"
      stops={stops}
      routeDrinkIntent={{ drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing, zeroProof: false }}
    />);
    const hrefs = [...html.matchAll(/href="(\/map\?[^\"]+)"/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      const search = href.split("?")[1]!;
      expect(routeDrinkIntentFromSearch(search)).toMatchObject({ drinkCategory: "beer", drinkSubtype: "beer-cider", zeroProof: false });
      expect(new URLSearchParams(search).get("routeServing")).toBe(drinkServing);
      expect(new URLSearchParams(search).get("pubs")).toBe("venue-a,venue-b");
      expect(href).not.toMatch(/pence|sourceUrl|observedAt|drinkLabel|nightArea|memberToken|lat=|lng=/);
    }
    expect(hrefs.filter((href) => new URLSearchParams(href.split("?")[1]!).has("sel"))).toHaveLength(2);
  });
});
