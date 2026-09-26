// Locked-plan route preview: geometry and bounds for the MapLibre embed on /plan/[id].
// Consecutive stop-to-stop legs only — same wire as GET /api/walk-route and the main map.

import { boundsFromCoords, type Bounds, type LngLat } from "@/lib/routeMiniMap";
import { stopPairs } from "@/lib/walkRoute";
import { routeStopsFromLngLats } from "@/components/map/canvas/geojson";

export type PlanCrawlRouteStop = {
  venueId: string;
  venueName: string;
  position: number;
};

export type ResolvedPlanCrawlRoute = {
  coords: LngLat[];
  names: string[];
  venueIds: string[];
  area: string;
};

/** Bounds for fitBounds: every stop plus every vertex on the drawn walking line. */
export function planCrawlRouteFitBounds(
  stopCoords: readonly LngLat[],
  lineCoords: readonly LngLat[],
): Bounds | null {
  return boundsFromCoords([...stopCoords, ...lineCoords]);
}

/** Straight pub-to-pub segments between consecutive stops only (N stops → N−1 legs). */
export function planCrawlStraightLineCoords(stops: LngLat[]): LngLat[] {
  if (stops.length < 2) return [];
  const pairs = stopPairs(stops);
  const line: LngLat[] = [];
  for (const pair of pairs) {
    if (line.length === 0) line.push(pair.from);
    line.push(pair.to);
  }
  return line;
}

export function planCrawlRouteGeoJSON(
  resolved: ResolvedPlanCrawlRoute,
  lineCoords: readonly LngLat[],
  source: "ors" | "straight",
): {
  routeLine: GeoJSON.FeatureCollection;
  routeStops: GeoJSON.FeatureCollection;
} {
  const routeLine: GeoJSON.FeatureCollection =
    lineCoords.length >= 2
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { source },
              geometry: {
                type: "LineString",
                coordinates: lineCoords.map(([lng, lat]) => [lng, lat]),
              },
            },
          ],
        }
      : { type: "FeatureCollection", features: [] };

  const routeStops = routeStopsFromLngLats(
    resolved.venueIds.map((id, index) => ({
      id,
      name: resolved.names[index] ?? "",
    })),
    resolved.coords,
  );

  return { routeLine, routeStops };
}
