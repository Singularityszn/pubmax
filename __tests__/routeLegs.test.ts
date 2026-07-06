import { describe, it, expect } from "vitest";

import {
  buildRouteLegs,
  formatLeg,
  formatRouteTotal,
  legMinutes,
  poisOnLeg,
  poisOnRoute,
  WALK_KMH,
  RUN_KMH,
  ON_THE_WAY_KM,
  type RouteLeg,
} from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";
import type { Poi } from "@/lib/pois";

// Minimal Venue fixture — routeLegs only reads id/name/latitude/longitude.
function v(id: string, name: string, longitude: number, latitude: number): Venue {
  return { id, name, latitude, longitude } as Venue;
}

// Minimal Poi fixture.
function poi(id: string, category: Poi["category"], lng: number, lat: number): Poi {
  return { id, name: id, category, coordinates: [lng, lat] };
}

describe("legMinutes", () => {
  it("is 0 for a zero or negative distance", () => {
    expect(legMinutes(0)).toBe(0);
    expect(legMinutes(-1)).toBe(0);
  });

  it("rounds up to at least 1 minute for any positive distance", () => {
    expect(legMinutes(0.001)).toBe(1);
  });

  it("matches the walking pace constant (WALK_KMH) at a round distance", () => {
    // At 4.8 km/h, 1km takes 12.5 minutes -> rounds up to 13.
    expect(legMinutes(1, "walk")).toBe(Math.ceil((1 / WALK_KMH) * 60));
  });

  it("is faster at running pace than walking pace for the same distance", () => {
    const walk = legMinutes(2, "walk");
    const run = legMinutes(2, "run");
    expect(run).toBeLessThan(walk);
    expect(run).toBe(Math.ceil((2 / RUN_KMH) * 60));
  });
});

describe("buildRouteLegs", () => {
  it("returns no legs for an empty or single-stop route", () => {
    expect(buildRouteLegs([]).legs).toHaveLength(0);
    expect(buildRouteLegs([v("a", "A", 0, 0)]).legs).toHaveLength(0);
  });

  it("builds one leg per adjacent pair, in order", () => {
    const route = [
      v("a", "A", -0.1, 51.5),
      v("b", "B", -0.101, 51.501),
      v("c", "C", -0.11, 51.51),
    ];
    const summary = buildRouteLegs(route);
    expect(summary.legs).toHaveLength(2);
    expect(summary.legs[0].fromIndex).toBe(0);
    expect(summary.legs[0].toIndex).toBe(1);
    expect(summary.legs[1].fromIndex).toBe(1);
    expect(summary.legs[1].toIndex).toBe(2);
  });

  it("sums leg distance and minutes into the route total", () => {
    const route = [
      v("a", "A", -0.1, 51.5),
      v("b", "B", -0.101, 51.501),
      v("c", "C", -0.11, 51.51),
    ];
    const summary = buildRouteLegs(route);
    const expectedKm = summary.legs.reduce((s, l) => s + l.distanceKm, 0);
    const expectedMin = summary.legs.reduce((s, l) => s + l.minutes, 0);
    expect(summary.totalKm).toBeCloseTo(expectedKm, 6);
    expect(summary.totalMinutes).toBe(expectedMin);
  });

  it("defaults to walk pace and threads a run pace through every leg", () => {
    const route = [v("a", "A", -0.1, 51.5), v("b", "B", -0.11, 51.51)];
    expect(buildRouteLegs(route).pace).toBe("walk");
    const runSummary = buildRouteLegs(route, "run");
    expect(runSummary.pace).toBe("run");
    expect(runSummary.legs[0].pace).toBe("run");
  });
});

describe("formatLeg / formatRouteTotal", () => {
  const leg: RouteLeg = {
    fromIndex: 0,
    toIndex: 1,
    from: v("a", "A", 0, 0),
    to: v("b", "B", 0, 0),
    distanceKm: 0.9,
    minutes: 12,
    pace: "walk",
  };

  it("labels distance as straight-line, honestly", () => {
    expect(formatLeg(leg)).toBe("12 min walk · 0.9 km, straight-line");
  });

  it("labels a run leg with 'run' instead of 'walk'", () => {
    expect(formatLeg({ ...leg, pace: "run" })).toContain("min run");
  });

  it("formats a route total the same honest way", () => {
    const summary = { legs: [leg], totalKm: 0.9, totalMinutes: 12, pace: "walk" as const };
    expect(formatRouteTotal(summary)).toBe("12 min walk total · 0.9 km, straight-line");
  });
});

describe("poisOnLeg", () => {
  const leg: RouteLeg = {
    fromIndex: 0,
    toIndex: 1,
    from: v("a", "A", -0.09, 51.505), // Borough Market-ish
    to: v("b", "B", -0.08, 51.506),
    distanceKm: 1,
    minutes: 15,
    pace: "walk",
  };

  it("includes an eligible-category POI within range of an endpoint", () => {
    const near = poi("market-1", "market", -0.0901, 51.5051); // ~a few metres from `from`
    const results = poisOnLeg(leg, [near]);
    expect(results).toHaveLength(1);
    expect(results[0].poi.id).toBe("market-1");
    expect(results[0].km).toBeLessThanOrEqual(ON_THE_WAY_KM);
  });

  it("excludes a POI outside the threshold distance", () => {
    const far = poi("market-2", "market", -0.2, 51.6); // clearly far away
    expect(poisOnLeg(leg, [far])).toHaveLength(0);
  });

  it("excludes ineligible categories even when very close (tube/rail/park/sight)", () => {
    const tube = poi("tube-1", "tube", -0.09, 51.505);
    const park = poi("park-1", "park", -0.09, 51.505);
    const sight = poi("sight-1", "sight", -0.09, 51.505);
    expect(poisOnLeg(leg, [tube, park, sight])).toHaveLength(0);
  });

  it("includes all four eligible categories: garden, market, historic, viewpoint", () => {
    const categories: Poi["category"][] = ["garden", "market", "historic", "viewpoint"];
    const pois = categories.map((c, i) => poi(`${c}-${i}`, c, -0.09, 51.505));
    const results = poisOnLeg(leg, pois);
    expect(results).toHaveLength(4);
  });

  it("sorts matches nearest-first", () => {
    const nearer = poi("historic-near", "historic", -0.0901, 51.5051);
    const fartherButInRange = poi("historic-far", "historic", -0.088, 51.507);
    const results = poisOnLeg(leg, [fartherButInRange, nearer]);
    expect(results[0].poi.id).toBe("historic-near");
  });

  it("respects a custom withinKm override", () => {
    const mid = poi("historic-mid", "historic", -0.087, 51.508);
    expect(poisOnLeg(leg, [mid], 0.05)).toHaveLength(0);
    expect(poisOnLeg(leg, [mid], 5)).toHaveLength(1);
  });
});

describe("poisOnRoute", () => {
  it("keys results by leg fromIndex and skips legs with no matches", () => {
    const route = [
      v("a", "A", -0.09, 51.505),
      v("b", "B", -0.08, 51.506),
      v("c", "C", -50, 20), // far away — its leg should have no matches
    ];
    const summary = buildRouteLegs(route);
    const nearby = poi("market-1", "market", -0.0899, 51.5049);
    const byLeg = poisOnRoute(summary.legs, [nearby]);
    expect(byLeg.has(0)).toBe(true);
    expect(byLeg.has(1)).toBe(false);
    expect(byLeg.get(0)?.[0].poi.id).toBe("market-1");
  });
});
