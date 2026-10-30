import type * as maplibregl from "maplibre-gl";

import type { LegOption, LegPart } from "@/lib/legOptions";
import { lineColour } from "@/lib/tfl";

import type { SceneCtx } from "./buildScene";

// The way to the next stop the reader chose in Night Mode ("Ways to get
// there", lib/legRouteOnMap.ts), drawn on the map like a maps app draws
// directions: a ride in its own TfL line colour on a white edge, a walk as a
// row of dots, and a straight-line walk estimate as a thin dashed line, so it
// never passes for a street route. It sits with the crawl route, under the
// pins, and it never moves the camera.

/** TfL's bus red, for a bus part (lib/tfl.ts LINE_COLOURS holds rail lines). */
const BUS_RED = "#DC241F";

/** The TfL line id for a line name: "Hammersmith & City" is "hammersmith-city". */
function lineIdFor(part: LegPart): string {
  if (part.mode === "elizabeth-line") return "elizabeth";
  if (part.mode === "dlr") return "dlr";
  if (part.mode === "tram") return "tram";
  return (part.line ?? "")
    .toLowerCase()
    .replace(/\s+line$/, "")
    .replace(/\s*&\s*/g, "-")
    .replace(/\s+/g, "-");
}

/** A part's colour: its TfL line colour, bus red, or null for a walk (the route colour). */
export function legPartColour(part: LegPart): string | null {
  if (part.mode === "walking") return null;
  if (part.mode === "bus") return BUS_RED;
  return lineColour(lineIdFor(part));
}

/** One LineString per part of the chosen way, or nothing when none is chosen. */
export function legRouteToLines(option: LegOption | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const part of option?.parts ?? []) {
    if (part.path.length < 2) continue;
    const colour = legPartColour(part);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: part.path },
      properties: {
        walk: part.mode === "walking",
        estimate: option!.estimate,
        colour: colour ?? "",
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export const LEG_ROUTE_LAYERS = ["leg-route-casing", "leg-route-ride", "leg-route-walk", "leg-route-estimate"] as const;

export function buildLegRoute(ctx: SceneCtx) {
  const { map, tokens, dark, addLayerOnce } = ctx;
  const data = ctx.legRoute ?? legRouteToLines(null);
  if (!map.getSource("leg-route")) {
    map.addSource("leg-route", { type: "geojson", data });
  }
  const ride: maplibregl.FilterSpecification = ["==", ["get", "walk"], false];
  const walk: maplibregl.FilterSpecification = ["all", ["==", ["get", "walk"], true], ["==", ["get", "estimate"], false]];
  const estimate: maplibregl.FilterSpecification = ["all", ["==", ["get", "walk"], true], ["==", ["get", "estimate"], true]];
  // The white edge under a ride, as a maps app draws it.
  addLayerOnce({
    id: "leg-route-casing",
    type: "line",
    source: "leg-route",
    filter: ride,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": dark ? tokens.inkDeep : tokens.paper, "line-width": 10, "line-opacity": 0.95 },
  });
  addLayerOnce({
    id: "leg-route-ride",
    type: "line",
    source: "leg-route",
    filter: ride,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "colour"], "line-width": 6 },
  });
  // A walk TfL planned: a row of round dots along the street path.
  addLayerOnce({
    id: "leg-route-walk",
    type: "line",
    source: "leg-route",
    filter: walk,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": tokens.routeLine, "line-width": 5, "line-dasharray": [0, 1.8] },
  });
  // A straight-line estimate: thin and dashed, never mistaken for a street route.
  addLayerOnce({
    id: "leg-route-estimate",
    type: "line",
    source: "leg-route",
    filter: estimate,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": tokens.routeLine, "line-width": 2.5, "line-dasharray": [2, 2], "line-opacity": 0.85 },
  });
}
