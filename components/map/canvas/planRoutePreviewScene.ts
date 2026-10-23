import type * as maplibregl from "maplibre-gl";
import { applyBasemapTaste } from "@/lib/mapBasemapTaste";
import { buildRoute, buildRouteStops, type SceneCtx } from "@/components/map/canvas/buildScene";
import { readTokens } from "@/components/map/canvas/tokens";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function emptyPoiHidden(): Record<PoiCategory, boolean> {
  return Object.fromEntries(POI_CATEGORIES.map((key) => [key, false])) as Record<PoiCategory, boolean>;
}

/**
 * Names face the card's middle (labelSide from planCrawlRouteGeoJSON), and
 * never the outer edge, which would clip them. That holds for the fallbacks
 * too: when the side anchor collides, a name drops under or over its disc but
 * still grows inward, instead of centring on a disc that sits at the card edge.
 * The side offset matches buildScene's 1.6em radial offset. The under/over
 * fallbacks sit 2em out so they clear their own disc's collision box.
 */
export const PREVIEW_STOP_NAME_ANCHOR_OFFSET = [
  "match",
  ["get", "labelSide"],
  "west",
  ["literal", ["right", [-1.6, 0], "top-right", [0.6, 2], "bottom-right", [0.6, -2]]],
  ["literal", ["left", [1.6, 0], "top-left", [-0.6, 2], "bottom-left", [-0.6, -2]]],
] satisfies maplibregl.ExpressionSpecification;

/** Route line + numbered stops on the live basemap — same layers as PubMapCanvas. */
export function syncPlanRoutePreviewScene(
  map: maplibregl.Map,
  routeLine: GeoJSON.FeatureCollection,
  routeStops: GeoJSON.FeatureCollection,
): void {
  // Scene already built on this style (a routed line arriving late): swap the
  // data only. Re-applying basemap taste would retint the stop labels as
  // basemap labels. A theme swap replaces the style, so it rebuilds in full.
  const lineSource = map.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
  const stopsSource = map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined;
  if (lineSource && stopsSource) {
    lineSource.setData(routeLine);
    stopsSource.setData(routeStops);
    return;
  }
  const tokens = readTokens();
  const dark = document.documentElement.dataset.theme === "dark";
  const addLayerOnce = (...args: Parameters<typeof map.addLayer>) => {
    if (!map.getLayer(args[0].id)) map.addLayer(...args);
  };
  const textFont = ["Noto Sans Bold"];
  applyBasemapTaste(
    map,
    {
      paper: tokens.paper,
      panelRaised: tokens.panelRaised,
      ink: tokens.ink,
      inkDeep: tokens.inkDeep,
      line: tokens.line,
      muted: tokens.muted,
      pint: tokens.pint,
      amber: tokens.amber,
      brass: tokens.brass,
      river: tokens.river,
      riverBright: tokens.riverBright,
      buildingEmissive: tokens.buildingEmissive,
      parkTint: tokens.parkTint,
    },
    dark,
  );
  const ctx = {
    map,
    tokens,
    dark,
    textFont,
    addLayerOnce,
    poiHidden: emptyPoiHidden(),
    transitLinesPath: null,
    showLandmarks: false,
    landmarksGeoJSON: EMPTY_FC,
    poisData: EMPTY_FC,
    routeLine,
    routeStops,
    bandCorridor: EMPTY_FC,
    bandColor: tokens.brass,
    bandMemberIds: [],
    pubsData: EMPTY_FC,
    userLocationData: EMPTY_FC,
    ukBaseData: EMPTY_FC,
    tonightData: EMPTY_FC,
    tonightVisible: false,
    coffeePilotData: EMPTY_FC,
    londonRestaurantData: EMPTY_FC,
    selectedId: "",
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;
  buildRoute(ctx);
  buildRouteStops(ctx);
  if (map.getLayer("route-stops-name")) {
    // The numbers claim their discs and are placed before the names in
    // buildRouteStops, which the card shares with the full map.
    map.setLayerZoomRange("route-stops-name", 10, 24);
    map.setLayoutProperty("route-stops-name", "text-variable-anchor-offset", PREVIEW_STOP_NAME_ANCHOR_OFFSET);
  }
}
