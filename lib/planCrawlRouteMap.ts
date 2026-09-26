// Locked-plan route preview: geometry and bounds for the MapLibre embed on /plan/[id].
// Consecutive stop-to-stop legs only — same wire as GET /api/walk-route and the main map.

import { boundsFromCoords, type Bounds, type LngLat } from "@/lib/routeMiniMap";
import { truncateStopName } from "@/lib/routeStopLabel";

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

  // The preview fits the whole route into a small card, so an end stop sits on
  // its edge. Its name faces the route's middle, or the card edge clips it.
  const bounds = planCrawlRouteFitBounds(resolved.coords, lineCoords);
  const midLng = bounds ? (bounds.minLng + bounds.maxLng) / 2 : 0;

  const routeStops: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: resolved.coords.map((coord, index) => ({
      type: "Feature" as const,
      properties: {
        id: resolved.venueIds[index] ?? `stop-${index}`,
        label: String(index + 1),
        name: resolved.names[index] ?? "",
        stopName: truncateStopName(resolved.names[index] ?? ""),
        labelSide: coord[0] > midLng ? "west" : "east",
      },
      geometry: { type: "Point" as const, coordinates: coord },
    })),
  };

  return { routeLine, routeStops };
}
