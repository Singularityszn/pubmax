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
  const heading = (daypart: string, areaName: string | null, startInput: string, now: string) =>
    routeHeading({ daypart, areaName, startInput, now: new Date(now) });

  it("names the area and the part of the day, and never a slug", () => {
    expect(heading("evening", "Clapham", "2026-10-07T19:00", "2026-10-07T12:00:00Z")).toBe("Tonight in Clapham");
    expect(heading("daytime", "Soho", "2026-10-07T13:00", "2026-10-07T09:00:00Z")).toBe("Today in Soho");
    expect(heading("evening", null, "2026-10-07T19:00", "2026-10-07T12:00:00Z")).toBe("Your route");
  });

  it("says tomorrow, then the weekday, for a night that is not today's", () => {
    expect(heading("evening", "Clapham", "2026-10-08T19:00", "2026-10-07T12:00:00Z")).toBe("Tomorrow night in Clapham");
    expect(heading("daytime", "Soho", "2026-10-08T13:00", "2026-10-07T12:00:00Z")).toBe("Tomorrow in Soho");
    expect(heading("evening", "Clapham", "2026-10-10T19:00", "2026-10-07T12:00:00Z")).toBe("Saturday night in Clapham");
    expect(heading("daytime", "Soho", "2026-10-11T13:00", "2026-10-07T12:00:00Z")).toBe("Sunday in Soho");
  });

  it("runs a night until 05:00 London, so the early hours belong to the evening before", () => {
    // 23:50 on Friday 9 Oct (BST) with a 00:15 start: the same night out.
    expect(heading("evening", "Clapham", "2026-10-10T00:15", "2026-10-09T22:50:00Z")).toBe("Tonight in Clapham");
    // From Wednesday noon, 04:59 on Saturday is still Friday night; 05:00 is Saturday's.
    expect(heading("evening", "Clapham", "2026-10-10T04:59", "2026-10-07T11:00:00Z")).toBe("Friday night in Clapham");
    expect(heading("evening", "Clapham", "2026-10-10T05:00", "2026-10-07T11:00:00Z")).toBe("Saturday night in Clapham");
    // 00:30 BST on 8 Oct is still the night of the 7th, so the 8th's evening is tomorrow.
    expect(heading("evening", "Clapham", "2026-10-08T19:00", "2026-10-07T23:30:00Z")).toBe("Tomorrow night in Clapham");
    expect(heading("evening", "Clapham", "2026-10-08T01:00", "2026-10-07T23:30:00Z")).toBe("Tonight in Clapham");
  });

  it("counts nights on London's clock across both clock changes", () => {
    // Back on 25 Oct: 23:50 UTC on the 24th is 00:50 BST on the 25th, and 01:30 is
    // the repeated hour, still Saturday's night.
    expect(heading("evening", "Clapham", "2026-10-25T01:30", "2026-10-24T23:50:00Z")).toBe("Tonight in Clapham");
    expect(heading("evening", "Clapham", "2026-10-26T19:00", "2026-10-25T23:30:00Z")).toBe("Tomorrow night in Clapham");
    // Forward on 29 Mar: 23:50 GMT on Saturday the 28th, with a 00:30 start.
    expect(heading("evening", "Clapham", "2026-03-29T00:30", "2026-03-28T23:50:00Z")).toBe("Tonight in Clapham");
    expect(heading("evening", "Clapham", "2026-03-29T19:00", "2026-03-28T23:30:00Z")).toBe("Tomorrow night in Clapham");
    // 01:30 on the 29th never happens in London, so the daypart's word stands.
    expect(heading("evening", "Clapham", "2026-03-29T01:30", "2026-03-28T23:50:00Z")).toBe("Tonight in Clapham");
  });

  it("names only the night for a start that has already passed", () => {
    expect(heading("evening", "Clapham", "2026-10-07T19:00", "2026-10-08T12:00:00Z")).toBe("Your night in Clapham");
    expect(heading("evening", "Clapham", "2026-10-07T19:00", "2026-10-07T18:01:00Z")).toBe("Your night in Clapham");
    expect(heading("evening", "Clapham", "2026-10-07T19:00", "2026-10-07T17:59:00Z")).toBe("Tonight in Clapham");
  });

  it("keeps the daypart's word for a start that is not a real time", () => {
    expect(heading("evening", "Clapham", "", "2026-10-07T12:00:00Z")).toBe("Tonight in Clapham");
  });
});
