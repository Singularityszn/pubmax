import { describe, expect, it } from "vitest";

import {
  formatPence,
  formatPenceFixed,
  legKey,
  measuredLegMinutes,
  routeHeading,
  routeSummaryLine,
  routeTotals,
  walkMinutesBetween,
  type RouteViewStop,
} from "@/lib/planRouteView";

const A: RouteViewStop = { venueId: "a", venueName: "A", estimatedPintPricePence: 560, priceKind: "listed" };
const B: RouteViewStop = {
  venueId: "b", venueName: "B", estimatedPintPricePence: 520, priceKind: "listed",
  walkingMinutesFromPrevious: 4, walkFromVenueId: "a",
};
const C: RouteViewStop = {
  venueId: "c", venueName: "C", estimatedPintPricePence: 660, priceKind: "estimated",
  walkingMinutesFromPrevious: 5, walkFromVenueId: "b",
};

describe("the Plan result summary line", () => {
  it("reads stops, price each and walk, each only when it is real", () => {
    expect(routeSummaryLine([A, B, C])).toBe("3 stops · £17.40 each · 9 min walk");
  });

  it("drops the price when one stop has none, rather than totalling a guess", () => {
    const unpriced = { ...C, estimatedPintPricePence: null };
    expect(routeSummaryLine([A, B, unpriced])).toBe("3 stops · 9 min walk");
    expect(routeTotals([A, B, unpriced]).pricePence).toBeNull();
  });

  it("says one stop in the singular and prints no walk for it", () => {
    expect(routeSummaryLine([A])).toBe("1 stop · £5.60 each");
  });

  it("prints whole pounds without pence in the summary and pence on every stamp", () => {
    expect(formatPence(800)).toBe("£8");
    expect(formatPence(1740)).toBe("£17.40");
    expect(formatPenceFixed(800)).toBe("£8.00");
  });
});

describe("the walk between two stops", () => {
  it("uses the generator's figure only when it was timed from this neighbour", () => {
    expect(walkMinutesBetween(A, B)).toBe(4);
    // A reorder put C after A: C's 5 minutes were from B, so it is not printed.
    expect(walkMinutesBetween(A, C)).toBeNull();
  });

  it("falls back to the walk the map measured for exactly this pair", () => {
    const measured = measuredLegMinutes(["a", "c"], [{ fromIndex: 0, toIndex: 1, distanceKm: 0.7, source: "ors" }]);
    expect(measured.get(legKey("a", "c"))).toBe(9);
    expect(walkMinutesBetween(A, C, measured)).toBe(9);
  });

  it("ignores legs with no distance", () => {
    const measured = measuredLegMinutes(["a", "b"], [{ fromIndex: 0, toIndex: 1, distanceKm: 0, source: "ors" }]);
    expect(measured.size).toBe(0);
  });

  it("never prints a straight-line leg as a measured walk", () => {
    const measured = measuredLegMinutes(["a", "c"], [{ fromIndex: 0, toIndex: 1, distanceKm: 0.7, source: "straight" }]);
    expect(measured.size).toBe(0);
    expect(walkMinutesBetween(A, C, measured)).toBeNull();
  });

  it("drops the walk total as soon as one leg cannot be timed", () => {
    expect(routeTotals([A, C, B]).walkMinutes).toBeNull();
  });
});

describe("the heading", () => {
  it("names the area and the part of the day, and never a slug", () => {
    expect(routeHeading("evening", "Clapham")).toBe("Tonight in Clapham");
    expect(routeHeading("daytime", "Soho")).toBe("Today in Soho");
    expect(routeHeading("evening", null)).toBe("Your route");
  });
});
