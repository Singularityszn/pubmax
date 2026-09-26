import { describe, expect, it } from "vitest";
import { createPropertyExpression, latest } from "@maplibre/maplibre-gl-style-spec";

import { PREVIEW_STOP_NAME_ANCHOR_OFFSET } from "@/components/map/canvas/planRoutePreviewScene";
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

describe("preview stop-name anchors", () => {
  // Evaluate the layout expression the way MapLibre does, per stop feature, and
  // read back the anchors placement may pick from, in order of preference.
  function anchorsFor(feature: GeoJSON.Feature): string[] {
    const parsed = createPropertyExpression(
      PREVIEW_STOP_NAME_ANCHOR_OFFSET,
      "layout.text-variable-anchor-offset",
      latest.layout_symbol["text-variable-anchor-offset"] as never,
    );
    if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
    const collection = parsed.value.evaluate({ zoom: 13 }, {
      type: "Point",
      properties: feature.properties ?? {},
    }) as { values: (string | [number, number])[] };
    return collection.values.filter((value): value is string => typeof value === "string");
  }

  it("keeps every fallback growing inward, so a collided end-stop name never overhangs the card edge", () => {
    const { routeStops } = planCrawlRouteGeoJSON(RESOLVED, RESOLVED.coords, "straight");
    const first = anchorsFor(routeStops.features[0]!);
    const last = anchorsFor(routeStops.features[2]!);

    // Westernmost stop: text is anchored on its left edge, so it runs east.
    expect(first[0]).toBe("left");
    for (const anchor of first) expect(anchor).toMatch(/left$/);
    // Easternmost stop: text is anchored on its right edge, so it runs west.
    expect(last[0]).toBe("right");
    for (const anchor of last) expect(anchor).toMatch(/right$/);
  });
});

describe("buildCrawlMapHref", () => {
  it("opens build mode with the ordered crawl on the main map", () => {
    const href = buildCrawlMapHref(["venue-a", "venue-b", "venue-c"]);
    expect(href).toMatch(/^\/map\?mode=build&pubs=/);
    expect(decodeURIComponent(href!)).toContain("venue-a,venue-b,venue-c");
  });
});
