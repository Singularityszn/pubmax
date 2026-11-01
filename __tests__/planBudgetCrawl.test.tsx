import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PlanBudgetLedger from "@/components/plan/PlanBudgetLedger";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  PLAN_BUDGET_CRAWL_LABEL,
  PLAN_BUDGET_CRAWL_PENCE,
  planBudgetCrawlQuery,
  planBudgetLedger,
  planBudgetMissLine,
} from "@/lib/planBudgetCrawl";
import { planPriceLimits } from "@/lib/planPriceLimits";
import {
  cheapestGroundedPlanRoute,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";

// The £20 crawl (launch plan section 3): the chip feeds the ONE budget path the
// generator already has, the route's listed pints fit the total at one pint a
// stop, the result shows a running total with each price's day, and a budget
// nothing fits names the cheapest route found and its total.

const NOW = Date.parse("2026-10-26T12:00:00.000Z");

function candidate(id: string, score: number, pence: number | null, dLat = 0): GroundedPlanRouteCandidate<string> {
  return {
    value: id,
    venueId: id,
    venueName: `The ${id}`,
    score,
    lat: 51.5 + dLat,
    lng: -0.1,
    price: pence === null
      ? { pence: null, source: null, confidenceState: "unknown" }
      : {
        pence,
        confidenceState: "fresh",
        source: { label: "Pint Prices", url: "https://example.com/menu", observedAt: "2026-10-02T12:00:00.000Z" },
      },
    promoted: false,
    avoidedByReviewedSignal: false,
    access: {},
    openingSchedule: null,
  };
}

function constraints(budgetLimitPence: number | null): GroundedPlanRouteConstraints {
  return {
    stopCount: 3,
    budgetLimitPence,
    budgetTier: "standard",
    exactArea: null,
    accessibilityNeeds: [],
    groupSize: null,
    transportConstraints: [],
    routeWindow: null,
    now: NOW,
  };
}

describe("the chip feeds the one budget path", () => {
  it("reads a priced crawl as the per-person route budget", () => {
    expect(planPriceLimits("a £20 crawl in Clapham").routeBudgetPence).toBe(2000);
    expect(planPriceLimits("£20 pub crawl in Soho").routeBudgetPence).toBe(2000);
    expect(inferNightContext("Quiet in Clapham for 4, a £20 crawl").context.budgetLimitPence).toBe(2000);
    // A drink between the figure and the word is a pint price, not a budget.
    expect(planPriceLimits("£5 pint crawl in Soho")).toEqual({ pintCeiling: 5, routeBudgetPence: null });
  });

  it("adds the £20 crawl to an ask, and leaves a budget the reader typed alone", () => {
    expect(PLAN_BUDGET_CRAWL_PENCE).toBe(2000);
    expect(planBudgetCrawlQuery("cheap pints tonight in Shoreditch")).toBe("cheap pints tonight in Shoreditch, a £20 crawl");
    expect(inferNightContext(planBudgetCrawlQuery("cheap pints tonight in Shoreditch")).context).toMatchObject({
      budgetLimitPence: 2000,
      nightArea: "shoreditch",
    });
    expect(planBudgetCrawlQuery("Soho, £30.00 per person")).toBe("Soho, £30.00 per person");
    expect(planBudgetCrawlQuery("  ")).toBe("");
  });
});

describe("the generator chooses stops whose listed pints fit", () => {
  const pool = [
    candidate("dear-1", 100, 700),
    candidate("dear-2", 99, 720),
    candidate("dear-3", 98, 690),
    candidate("cheap-1", 10, 450),
    candidate("cheap-2", 9, 520),
    candidate("cheap-3", 8, 610),
    candidate("unpriced", 200, null),
  ];

  it("fits: every stop carries a listed pint and the total is inside £20", () => {
    const result = selectGroundedPlanRoute(pool, constraints(2000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.every((stop) => stop.price.source !== null)).toBe(true);
    const total = result.stops.reduce((sum, stop) => sum + stop.price.pence!, 0);
    expect(total).toBeLessThanOrEqual(2000);
    expect(result.stops.map((stop) => stop.venueId)).not.toContain("unpriced");
  });

  it("does not fit: no route, and the cheapest fully priced route found with its total", () => {
    const tight = constraints(1400);
    expect(selectGroundedPlanRoute(pool, tight).ok).toBe(false);
    const cheapest = cheapestGroundedPlanRoute(pool, tight);
    expect(cheapest).not.toBeNull();
    expect(new Set(cheapest!.stops.map((stop) => stop.venueId))).toEqual(new Set(["cheap-1", "cheap-2", "cheap-3"]));
    expect(cheapest!.totalPence).toBe(450 + 520 + 610);
    // The stops keep their own fit scores; the price-first search is internal.
    expect(cheapest!.stops.find((stop) => stop.venueId === "cheap-1")?.score).toBe(10);
  });

  it("names no cheapest route without a budget, or when nothing is fully priced", () => {
    expect(cheapestGroundedPlanRoute(pool, constraints(null))).toBeNull();
    expect(cheapestGroundedPlanRoute([candidate("a", 1, null), candidate("b", 1, null), candidate("c", 1, null)], constraints(2000))).toBeNull();
  });

  it("still keeps every other hard rule in the cheapest route: no leg over the walk cap", () => {
    const spread = [
      candidate("here-1", 1, 500),
      candidate("here-2", 1, 500),
      candidate("here-3", 1, 900),
      candidate("miles-away", 1, 100, 0.2),
    ];
    const cheapest = cheapestGroundedPlanRoute(spread, constraints(1000));
    expect(cheapest?.stops.map((stop) => stop.venueId)).not.toContain("miles-away");
    expect(cheapest?.totalPence).toBe(1900);
  });
});

describe("the refusal says so with the cheapest route and its total", () => {
  it("names the route and its total", () => {
    expect(planBudgetMissLine({
      stopCount: 3,
      areaName: "Soho",
      limitPence: 2000,
      cheapest: [
        { venueName: "The Crown", pricePence: 720 },
        { venueName: "The Ship", pricePence: 690 },
        { venueName: "The Lamb", pricePence: 710 },
      ],
    })).toBe(
      "No 3-stop route in Soho fits £20.00 for one listed pint at each stop. The cheapest we found is £21.20: The Crown, The Ship and The Lamb.",
    );
  });

  it("says when there is no fully priced route to compare", () => {
    expect(planBudgetMissLine({ stopCount: 3, areaName: "Soho", limitPence: 2000, cheapest: null })).toBe(
      "No 3-stop route in Soho fits £20.00 for one listed pint at each stop. We could not find a fully priced route to compare.",
    );
  });
});

describe("the running total", () => {
  const stops = [
    { venueName: "The Crown", pricePence: 480, priceKind: "listed" as const, priceObservedAt: "2026-10-02T12:00:00.000Z" },
    { venueName: "The Ship", pricePence: 510, priceKind: "listed" as const, priceObservedAt: null },
    { venueName: "The Lamb", pricePence: 600, priceKind: "listed" as const, priceObservedAt: "2026-09-14" },
  ];

  it("adds one listed pint a stop, with each price's day", () => {
    const ledger = planBudgetLedger(stops, 2000);
    expect(ledger.rows.map((row) => [row.price, row.readLine, row.runningTotal])).toEqual([
      ["£4.80", "listed 2 Oct", "£4.80"],
      ["£5.10", "read date not recorded", "£9.90"],
      ["£6.00", "listed 14 Sept", "£15.90"],
    ]);
    expect(ledger).toMatchObject({ totalPence: 1590, fits: true });
    expect(ledger.summary).toBe("£15.90 for one pint at each stop, inside your £20.00.");
  });

  it("says a total over the budget is over it", () => {
    const ledger = planBudgetLedger(stops, 1500);
    expect(ledger.fits).toBe(false);
    expect(ledger.summary).toBe("£15.90 for one pint at each stop, over your £15.00.");
  });

  it("never sums an estimate or a missing figure into a total", () => {
    const ledger = planBudgetLedger(
      [stops[0]!, { venueName: "The Guess", pricePence: 400, priceKind: "estimated" }, stops[2]!],
      2000,
    );
    expect(ledger.rows[1]).toMatchObject({ price: null, runningTotal: null });
    expect(ledger.rows[2]?.runningTotal).toBeNull();
    expect(ledger).toMatchObject({ totalPence: null, fits: null });
    expect(ledger.summary).toBe("No total yet: a stop has no listed pint price, so we cannot say it fits £20.00.");
  });
});

describe("the surfaces render", () => {
  it("the ledger prints each price with its day and the running total", () => {
    const html = renderToStaticMarkup(
      <PlanBudgetLedger
        limitPence={2000}
        stops={[
          { venueName: "The Crown", pricePence: 480, priceKind: "listed", priceObservedAt: "2026-10-02" },
          { venueName: "The Ship", pricePence: 510, priceKind: "listed", priceObservedAt: "2026-10-02" },
        ]}
      />,
    );
    expect(html).toContain("Your £20.00 crawl, one pint a stop");
    expect(html).toContain("1. The Crown");
    expect(html).toContain("£4.80");
    expect(html).toContain("listed 2 Oct");
    expect(html).toContain("Running total £9.90");
    expect(html).toContain("£9.90 for one pint at each stop, inside your £20.00.");
  });

  it("describe-first offers the £20 crawl as an option, off until tapped", () => {
    const html = renderToStaticMarkup(
      <PlanDescribeFirst onSubmit={() => {}} onGuideMeInstead={() => {}} />,
    );
    expect(html).toContain(PLAN_BUDGET_CRAWL_LABEL);
    expect(html).toMatch(/aria-pressed="false"[^>]*>£20 crawl</);
    expect(html).toContain("Stops whose listed pints add up to £20 or less, one pint a stop.");
  });
});
