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
  areaDescription: string;
};

/** Describe all recorded stop areas without assigning a borough from distance. */
export function planRouteAreaDescription(areas: readonly string[]): string {
  const labels = areas.map((area) => area.trim());
  if (labels.length === 0 || labels.some((area) => !area)) return "";
  const unique = [...new Set(labels)].sort((left, right) => left.localeCompare(right, "en-GB"));
  if (unique.length === 1) return `in ${unique[0]}`;
  const last = unique.pop();
  return `across ${unique.join(", ")} and ${last}`;
}

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

/** Two stop discs (radius 16, stroke 2.5) touch below this many pixels apart. */
const STOP_DISC_CLEARANCE_PX = 37;

/** Web Mercator pixel position at `zoom`, on MapLibre's 512 px world tile. */
function worldPixel([lng, lat]: LngLat, zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

/**
 * The preview cannot zoom past the stops' spread, so two pubs a few doors
 * apart would stack their discs and hide a number. Stops whose discs would
 * touch at `zoom` share one disc, numbered "1·2" and naming each pub.
 */
export function mergeCrowdedRouteStops(
  routeStops: GeoJSON.FeatureCollection,
  zoom: number,
): GeoJSON.FeatureCollection {
  const stops = routeStops.features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Point> => feature.geometry?.type === "Point",
  );
  if (stops.length !== routeStops.features.length || !Number.isFinite(zoom)) return routeStops;
  const pixels = stops.map((stop) => worldPixel(stop.geometry.coordinates as LngLat, zoom));
  const group = stops.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index]!)));
  for (let left = 0; left < stops.length; left += 1) {
    for (let right = left + 1; right < stops.length; right += 1) {
      const [lx, ly] = pixels[left]!;
      const [rx, ry] = pixels[right]!;
      if (Math.hypot(lx - rx, ly - ry) < STOP_DISC_CLEARANCE_PX) group[root(right)] = root(left);
    }
  }
  const members = new Map<number, number[]>();
  stops.forEach((_, index) => members.set(root(index), [...(members.get(root(index)) ?? []), index]));
  if (members.size === stops.length) return routeStops;
  return {
    type: "FeatureCollection",
    features: [...members.values()].map((indexes) => {
      const first = stops[indexes[0]!]!;
      if (indexes.length === 1) return first;
      const coords = indexes.map((index) => stops[index]!.geometry.coordinates);
      return {
        type: "Feature" as const,
        properties: {
          ...first.properties,
          label: indexes.map((index) => stops[index]!.properties?.label).join("·"),
          stopName: indexes.map((index) => stops[index]!.properties?.stopName).join("\n"),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [0, 1].map((axis) => coords.reduce((sum, coord) => sum + coord[axis]!, 0) / coords.length),
        },
      };
    }),
  };
}
