import { describe, expect, it } from "vitest";
import { orientRouteStopLabels } from "@/lib/routeStopLabel";

const stops: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-0.13, 51.51] }, properties: { label: "1", labelSide: "west" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [-0.14, 51.51] }, properties: { label: "2", labelSide: "east" } },
  ],
};

describe("route names inside the visible map", () => {
  it("changes label direction when rotation exchanges the screen sides", () => {
    const result = orientRouteStopLabels(stops, ([lng]) => lng === -0.13 ? 30 : 290, 160);
    expect(result.features.map((feature) => feature.properties?.labelSide)).toEqual(["east", "west"]);
    expect(result.features.map((feature) => feature.properties?.label)).toEqual(["1", "2"]);
    expect(stops.features[0]?.properties?.labelSide).toBe("west");
  });

  it("does not replace source data when the existing directions still fit", () => {
    expect(orientRouteStopLabels(stops, ([lng]) => lng === -0.13 ? 290 : 30, 160)).toBe(stops);
  });
});
