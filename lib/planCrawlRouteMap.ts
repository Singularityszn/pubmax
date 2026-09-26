// Locked-plan route preview: geometry and bounds for the MapLibre embed on /plan/[id].
// Consecutive stop-to-stop legs only — same wire as GET /api/walk-route and the main map.

import { boundsFromCoords, type Bounds, type LngLat } from "@/lib/routeMiniMap";

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

const ROUTE_STOP_LABEL_MAX = 18;

function truncateStopName(name: string, max = ROUTE_STOP_LABEL_MAX): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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

  const routeStops: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: resolved.coords.map((coord, index) => ({
      type: "Feature" as const,
      properties: {
        id: resolved.venueIds[index] ?? `stop-${index}`,
        label: String(index + 1),
        name: resolved.names[index] ?? "",
        stopName: truncateStopName(resolved.names[index] ?? ""),
      },
      geometry: { type: "Point" as const, coordinates: coord },
    })),
  };

  return { routeLine, routeStops };
}
