import type * as maplibregl from "maplibre-gl";

import { DONUT_OUTER_RADIUS_SMALL, DONUT_RING_PX } from "@/lib/donutClusterGeometry";
import { lngLatOf } from "@/lib/geo";

import type { SceneCtx } from "./buildScene";
import { OSM_ATTRIBUTION } from "./tokens";

// The UK base layer below its zoom gate (lib/ukBaseOverview.ts): count bubbles
// where the country's unpriced pubs are, so a zoomed-out map is never empty.
//
// A bubble wears the curated cluster's disc at its smaller size, without the
// ink casing and at the base pin's opacity, with a count and never a price: it is the same "a pub is here,
// nobody has said what a pint costs" claim the base pin makes. It sits under
// every curated layer and stops at the gate, where the real pins take over.

export const UK_BASE_OVERVIEW_SOURCE = "uk-base-overview";
const UK_BASE_OVERVIEW_LAYER = "uk-base-overview";
// clickHitPriority.ts names both layers for taps and the cursor.
const UK_BASE_OVERVIEW_COUNT_LAYER = "uk-base-overview-count";

/** Grouping radius in screen pixels: two smaller discs plus a margin. */
const OVERVIEW_CLUSTER_RADIUS_PX = 48;
const OVERVIEW_OPACITY = 0.85;
const OVERVIEW_COUNT_SIZE_PX = 11;

/** "842", "4.1k", "38k": the figure must fit a 36 px disc. */
const OVERVIEW_COUNT_EXPR: maplibregl.ExpressionSpecification = [
  "let",
  "n",
  ["get", "n"],
  [
    "case",
    [">=", ["var", "n"], 10000],
    ["concat", ["number-format", ["/", ["var", "n"], 1000], { "max-fraction-digits": 0 }], "k"],
    [">=", ["var", "n"], 1000],
    ["concat", ["number-format", ["/", ["var", "n"], 1000], { "max-fraction-digits": 1 }], "k"],
    ["to-string", ["var", "n"]],
  ],
];

export function buildUkBaseOverview(ctx: SceneCtx, pinMinZoom: number) {
  const { map, tokens, dark, textFont, addLayerOnce } = ctx;
  if (!map.getSource(UK_BASE_OVERVIEW_SOURCE)) {
    map.addSource(UK_BASE_OVERVIEW_SOURCE, {
      type: "geojson",
      data: ctx.ukBaseOverviewData ?? { type: "FeatureCollection", features: [] },
      attribution: OSM_ATTRIBUTION,
      cluster: true,
      clusterRadius: OVERVIEW_CLUSTER_RADIUS_PX,
      // The last zoom it draws at. From the gate on, the pins are the answer.
      clusterMaxZoom: pinMinZoom - 1,
      clusterProperties: { n: ["+", ["get", "n"]] },
    });
  }
  const outer = DONUT_OUTER_RADIUS_SMALL;
  addLayerOnce({
    id: UK_BASE_OVERVIEW_LAYER,
    type: "circle",
    source: UK_BASE_OVERVIEW_SOURCE,
    maxzoom: pinMinZoom,
    paint: {
      // The curated disc's fill and neutral ring without its ink casing: the
      // same family, one step quieter.
      "circle-color": tokens.panelRaised,
      "circle-radius": outer - DONUT_RING_PX,
      "circle-stroke-color": tokens.line,
      "circle-stroke-width": DONUT_RING_PX,
      "circle-opacity": OVERVIEW_OPACITY,
      "circle-stroke-opacity": OVERVIEW_OPACITY,
    },
  });
  addLayerOnce({
    id: UK_BASE_OVERVIEW_COUNT_LAYER,
    type: "symbol",
    source: UK_BASE_OVERVIEW_SOURCE,
    maxzoom: pinMinZoom,
    layout: {
      "text-field": OVERVIEW_COUNT_EXPR,
      "text-font": textFont,
      "text-size": OVERVIEW_COUNT_SIZE_PX,
      "text-letter-spacing": 0.01,
      // The count always draws, and its box padded to the disc's rim keeps
      // basemap labels off the disc, as a curated cluster's figure does.
      "text-allow-overlap": true,
      "text-ignore-placement": false,
      "text-padding": outer - OVERVIEW_COUNT_SIZE_PX / 2,
    },
    paint: {
      "text-color": dark ? tokens.ink : tokens.inkDeep,
      "text-opacity": OVERVIEW_OPACITY,
    },
  });
}

/**
 * A tap on a bubble zooms in: to where a cluster splits, or to the gate for a
 * single cell, where its pins stream in.
 */
export function zoomIntoUkBaseOverview(
  map: maplibregl.Map,
  feature: maplibregl.MapGeoJSONFeature,
  pinMinZoom: number,
  flyTo: (center: [number, number], zoom: number) => void,
) {
  const center = lngLatOf((feature.geometry as GeoJSON.Point).coordinates);
  if (!center) return;
  const clusterId = feature.properties?.cluster_id;
  const source = map.getSource(UK_BASE_OVERVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (typeof clusterId !== "number" || !source) {
    flyTo(center, pinMinZoom);
    return;
  }
  void source
    .getClusterExpansionZoom(clusterId)
    .then((zoom) => flyTo(center, Math.min(zoom, pinMinZoom)))
    .catch(() => flyTo(center, pinMinZoom));
}
