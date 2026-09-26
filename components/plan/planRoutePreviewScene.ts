import type * as maplibregl from "maplibre-gl";
import { applyBasemapTaste } from "@/lib/mapBasemapTaste";
import { buildRoute, buildRouteStops, type SceneCtx } from "@/components/map/canvas/buildScene";
import { readTokens } from "@/components/map/canvas/tokens";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function emptyPoiHidden(): Record<PoiCategory, boolean> {
  return Object.fromEntries(POI_CATEGORIES.map((key) => [key, false])) as Record<PoiCategory, boolean>;
}

/** Route line + numbered stops on the live basemap — same layers as PubMapCanvas. */
export function syncPlanRoutePreviewScene(
  map: maplibregl.Map,
  routeLine: GeoJSON.FeatureCollection,
  routeStops: GeoJSON.FeatureCollection,
): void {
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
    selectedId: "",
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;
  buildRoute(ctx);
  buildRouteStops(ctx);
  const lineSource = map.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
  const stopsSource = map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined;
  lineSource?.setData(routeLine);
  stopsSource?.setData(routeStops);
  if (map.getLayer("route-stops-name")) {
    map.setLayerZoomRange("route-stops-name", 10, 24);
  }
}
