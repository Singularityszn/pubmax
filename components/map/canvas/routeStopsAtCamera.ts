import type * as maplibregl from "maplibre-gl";
import { mergeCrowdedRouteStops } from "@/lib/routeStopDiscs";
import { orientRouteStopLabels } from "@/lib/routeStopLabel";

type Shown = { stops: GeoJSON.FeatureCollection | null; leadId?: string; key: string; source?: unknown };

const shownByMap = new WeakMap<maplibregl.Map, Shown>();

function viewKey(view: GeoJSON.FeatureCollection): string {
  return view.features.map((feature) => {
    const { id, label, labelSide } = feature.properties ?? {};
    return `${id}:${label}:${labelSide}`;
  }).join("|");
}

/**
 * Paints the route stops as they read at the map's camera: stops whose discs
 * would touch share one disc, and names face the screen's middle. `stops` is
 * a new route and `leadId` the selected stop. With neither, the camera moved,
 * and the source is written only when the discs or names change.
 */
export function showRouteStopsAtCamera(
  map: maplibregl.Map,
  change: { stops?: GeoJSON.FeatureCollection; leadId?: string } = {},
): void {
  const shown = shownByMap.get(map) ?? { stops: null, key: "" };
  shownByMap.set(map, shown);
  if (change.stops) shown.stops = change.stops;
  if ("leadId" in change) shown.leadId = change.leadId;
  const source = map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined;
  if (!shown.stops || !source) return;
  const view = orientRouteStopLabels(
    mergeCrowdedRouteStops(shown.stops, map.getZoom(), shown.leadId),
    (point) => map.project(point).x,
    map.getContainer().clientWidth / 2,
  );
  const key = viewKey(view);
  if (!change.stops && key === shown.key && source === shown.source) return;
  shown.key = key;
  shown.source = source;
  source.setData(view);
}

/** Crowded stops part, or join, while the reader zooms, not only once the camera rests. */
export function followRouteStopsCamera(map: maplibregl.Map): void {
  const follow = () => showRouteStopsAtCamera(map);
  map.on("zoom", follow);
  map.on("moveend", follow);
}
