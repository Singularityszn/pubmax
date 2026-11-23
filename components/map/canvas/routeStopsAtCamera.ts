import type * as maplibregl from "maplibre-gl";
import { mergeCrowdedRouteStops, type RouteStopCamera } from "@/lib/routeStopDiscs";
import type { LngLat } from "@/lib/routeMiniMap";
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
 * The live camera, pitch and bearing included. A tilted map paints each disc
 * scaled by the centre's depth over the stop's, and the ground across the
 * screen at a stop holds one depth, so its screen scale there against the
 * centre's is that same ratio.
 */
function liveRouteStopCamera(map: maplibregl.Map): RouteStopCamera {
  const bearing = (map.getBearing() * Math.PI) / 180;
  const across = ([lng, lat]: LngLat) => {
    const step = 1e-5;
    const from = map.project([lng, lat]);
    const to = map.project([lng + step * Math.cos(bearing), lat - step * Math.sin(bearing) * Math.cos((lat * Math.PI) / 180)]);
    return Math.hypot(to.x - from.x, to.y - from.y);
  };
  const { lng, lat } = map.getCenter();
  const atCenter = across([lng, lat]);
  return {
    zoom: map.getZoom(),
    place: (point) => ({ ...map.project(point), scale: across(point) / atCenter }),
  };
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
    mergeCrowdedRouteStops(shown.stops, liveRouteStopCamera(map), shown.leadId),
    (point) => map.project(point).x,
    map.getContainer().clientWidth / 2,
  );
  const key = viewKey(view);
  if (!change.stops && key === shown.key && source === shown.source) return;
  shown.key = key;
  shown.source = source;
  source.setData(view);
}

/** Crowded stops part, or join, while the reader zooms, tilts or turns, not only once the camera rests. */
export function followRouteStopsCamera(map: maplibregl.Map): void {
  const follow = () => showRouteStopsAtCamera(map);
  for (const event of ["zoom", "pitch", "rotate"] as const) map.on(event, follow);
  map.on("moveend", follow);
}
