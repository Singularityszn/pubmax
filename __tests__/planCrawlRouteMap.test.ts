import { describe, expect, it } from "vitest";

import { buildCrawlMapHref } from "@/lib/crawlUrl";
import {
  planCrawlRouteFitBounds,
  planCrawlRouteGeoJSON,
  type ResolvedPlanCrawlRoute,
} from "@/lib/planCrawlRouteMap";
const RESOLVED: ResolvedPlanCrawlRoute = {
  coords: [
    [-0.14, 51.51],
    [-0.135, 51.515],
    [-0.13, 51.52],
  ],
  names: ["First", "Middle", "Last"],
  venueIds: ["a", "b", "c"],
  area: "Westminster",
};

describe("planCrawlRouteFitBounds", () => {
  it("includes routed detour vertices outside the stop extent", () => {
    const detour: [number, number][] = [
      [-0.14, 51.51],
      [-0.16, 51.515],
      [-0.13, 51.52],
    ];
    const bounds = planCrawlRouteFitBounds(RESOLVED.coords, detour);
    expect(bounds).not.toBeNull();
    expect(bounds!.minLng).toBeLessThanOrEqual(-0.16);
    expect(bounds!.maxLng).toBeGreaterThanOrEqual(-0.13);
  });
});

describe("planCrawlRouteGeoJSON", () => {
  it("labels numbered stops with pub names", () => {
    const { routeStops } = planCrawlRouteGeoJSON(
      RESOLVED,
      RESOLVED.coords,
      "straight",
    );
    expect(routeStops.features).toHaveLength(3);
    expect(routeStops.features[0]?.properties?.label).toBe("1");
    expect(routeStops.features[1]?.properties?.stopName).toContain("Middle");
  });

  it("points each end stop's name at the route's middle so the card edge cannot clip it", () => {
    const { routeStops } = planCrawlRouteGeoJSON(RESOLVED, RESOLVED.coords, "straight");
    const sides = routeStops.features.map((feature) => feature.properties?.labelSide);
    // First stop is the westernmost, last the easternmost.
    expect(sides[0]).toBe("east");
    expect(sides[2]).toBe("west");
  });

  it("measures the middle across a routed detour, not just the stops", () => {
    const detour: [number, number][] = [
      [-0.14, 51.51],
      [-0.2, 51.515],
      [-0.13, 51.52],
    ];
    const { routeStops } = planCrawlRouteGeoJSON(RESOLVED, detour, "ors");
    // The detour stretches the fitted box west, so every stop sits east of its middle.
    expect(routeStops.features.map((f) => f.properties?.labelSide)).toEqual([
      "west",
      "west",
      "west",
    ]);
  });
});

describe("buildCrawlMapHref", () => {
  it("opens build mode with the ordered crawl on the main map", () => {
    const href = buildCrawlMapHref(["venue-a", "venue-b", "venue-c"]);
    expect(href).toMatch(/^\/map\?mode=build&pubs=/);
    expect(decodeURIComponent(href!)).toContain("venue-a,venue-b,venue-c");
  });
});
