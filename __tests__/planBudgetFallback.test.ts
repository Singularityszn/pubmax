import { describe, expect, it } from "vitest";
import {
  selectAnchoredGroundedPlanRoute,
  selectGroundedPlanRoute,
  type GroundedPlanRouteCandidate,
  type GroundedPlanRouteConstraints,
} from "@/lib/planRouteOptimizer";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");

function candidate(id: string, score: number, pence: number): GroundedPlanRouteCandidate<string> {
  return {
    value: id, venueId: id, venueName: id, score, lat: 51.5, lng: -0.1,
    price: {
      pence, confidenceState: "fresh",
      source: { label: "Pub menu", url: "https://example.com/menu", observedAt: "2026-10-25T12:00:00.000Z" },
    },
    promoted: false, avoidedByReviewedSignal: false, access: {}, openingSchedule: null,
  };
}

function constraints(stopCount: number): GroundedPlanRouteConstraints {
  return {
    stopCount, budgetLimitPence: stopCount * 400, budgetTier: "standard",
    exactArea: null, accessibilityNeeds: [], groupSize: null,
    transportConstraints: [], routeWindow: null, now: NOW,
  };
}

function pool(affordableCount: number): GroundedPlanRouteCandidate<string>[] {
  return [
    ...Array.from({ length: 14 }, (_, index) => candidate(`popular-${index}`, 100 - index, 600)),
    ...Array.from({ length: affordableCount }, (_, index) => candidate(`affordable-${index}`, 10 - index, 400)),
  ];
}

describe("budget routes beyond the highest-scoring pubs", () => {
  it.each([2, 3, 4, 5, 6])("finds an affordable %i-stop route", (stopCount) => {
    const result = selectGroundedPlanRoute(pool(stopCount), constraints(stopCount));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops).toHaveLength(stopCount);
    expect(result.stops.every((stop) => stop.venueId.startsWith("affordable-"))).toBe(true);
    expect(result.stops.reduce((total, stop) => total + stop.price.pence!, 0)).toBe(stopCount * 400);
  });

  it.each([2, 3, 4, 5, 6])("retains the anchor in an affordable %i-stop route", (stopCount) => {
    const result = selectAnchoredGroundedPlanRoute(
      [candidate("anchor", 1, 400), ...pool(stopCount - 1)], constraints(stopCount), "anchor",
    );
    expect(result.ok && result.outcome).toBe("route");
    if (!result.ok || result.outcome !== "route") return;
    expect(result.stops[0]?.venueId).toBe("anchor");
    expect(result.stops).toHaveLength(stopCount);
    expect(result.stops.reduce((total, stop) => total + stop.price.pence!, 0)).toBe(stopCount * 400);
  });

  it("keeps the strongest route when it already fits the ceiling", () => {
    const result = selectGroundedPlanRoute(pool(3), { ...constraints(3), budgetLimitPence: 1800 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.stops.map((stop) => stop.venueId))).toEqual(new Set([
      "popular-0", "popular-1", "popular-2",
    ]));
  });

  it("preserves operator variety in the affordable route", () => {
    const candidates = pool(3).map((stop) => ({ ...stop, operator: stop.venueId }));
    const result = selectGroundedPlanRoute(candidates, { ...constraints(3), oneStopPerOperator: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.stops.map((stop) => stop.operator)).size).toBe(3);
    expect(result.stops.every((stop) => stop.venueId.startsWith("affordable-"))).toBe(true);
  });

  it("retains the operator fallback when only branches of one chain fit", () => {
    const candidates = pool(3).map((stop) => ({ ...stop, operator: "one-chain" }));
    const result = selectGroundedPlanRoute(candidates, { ...constraints(3), oneStopPerOperator: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stops.every((stop) => stop.venueId.startsWith("affordable-"))).toBe(true);
  });

  it.each(["missing-price", "over-budget", "long-walk", "opening-hours"])(
    "keeps the hard refusal for %s", (refusal) => {
      const candidates = pool(3).map((stop) => refusal === "missing-price" && stop.venueId.startsWith("affordable-")
        ? { ...stop, price: { pence: null, source: null, confidenceState: "unknown" as const } }
        : stop);
      const result = selectGroundedPlanRoute(candidates, {
        ...constraints(3),
        ...(refusal === "over-budget" ? { budgetLimitPence: 1199 } : {}),
        ...(refusal === "long-walk" ? { streetWalkKm: () => 2 } : {}),
        ...(refusal === "opening-hours" ? {
          routeWindow: { startsAt: "2026-10-26T19:00:00.000Z", endsAt: "2026-10-26T23:00:00.000Z" },
        } : {}),
      });
      expect(result.ok).toBe(false);
    },
  );

});
