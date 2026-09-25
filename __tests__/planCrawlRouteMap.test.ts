import { describe, expect, it } from "vitest";

import { buildCrawlMapHref } from "@/lib/crawlUrl";
import {
  planCrawlRouteFitBounds,
  planCrawlRouteGeoJSON,
  planCrawlStraightLineCoords,
  type ResolvedPlanCrawlRoute,
} from "@/lib/planCrawlRouteMap";
import { stopPairs } from "@/lib/walkRoute";

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

describe("planCrawlStraightLineCoords", () => {
  it("walks consecutive stops only (N stops → N−1 legs)", () => {
    const line = planCrawlStraightLineCoords(RESOLVED.coords);
    expect(line).toHaveLength(RESOLVED.coords.length);
    expect(stopPairs(RESOLVED.coords)).toHaveLength(2);
    expect(line[0]).toEqual(RESOLVED.coords[0]);
    expect(line[line.length - 1]).toEqual(RESOLVED.coords[2]);
  });
});

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
      planCrawlStraightLineCoords(RESOLVED.coords),
      "straight",
    );
    expect(routeStops.features).toHaveLength(3);
    expect(routeStops.features[0]?.properties?.label).toBe("1");
    expect(routeStops.features[1]?.properties?.stopName).toContain("Middle");
  });
});

describe("buildCrawlMapHref", () => {
  it("opens build mode with the ordered crawl on the main map", () => {
    const href = buildCrawlMapHref(["venue-a", "venue-b", "venue-c"]);
    expect(href).toMatch(/^\/map\?mode=build&pubs=/);
    expect(decodeURIComponent(href!)).toContain("venue-a,venue-b,venue-c");
  });
});
