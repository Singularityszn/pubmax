// The numbered route-stop discs, as the full map and the plan's route preview
// draw them. One owner for their size, so the rule that joins crowded stops
// measures the same disc the map paints.
import type { ExpressionSpecification } from "maplibre-gl";
import type { LngLat } from "@/lib/routeMiniMap";

/** A curated walk's discs start at half size at z12 and grow to the full disc by z15. */
const DISC = { radius: 16, stroke: 2.5, walkRadius: 8, walkStroke: 1.5, walkFromZoom: 12, fullFromZoom: 15 };

const IS_WALK: ExpressionSpecification = ["==", ["get", "walk"], true];

export const ROUTE_STOP_DISC_RADIUS: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  DISC.walkFromZoom, ["case", IS_WALK, DISC.walkRadius, DISC.radius],
  DISC.fullFromZoom, DISC.radius,
];

export const ROUTE_STOP_DISC_STROKE: ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  DISC.walkFromZoom, ["case", IS_WALK, DISC.walkStroke, DISC.stroke],
  DISC.fullFromZoom, DISC.stroke,
];

/** The painted width of one disc at `zoom`. MapLibre draws the stroke outside the radius. */
export function routeStopDiscWidth(zoom: number, walk: boolean): number {
  const grown = walk
    ? Math.min(1, Math.max(0, (zoom - DISC.walkFromZoom) / (DISC.fullFromZoom - DISC.walkFromZoom)))
    : 1;
  const radius = DISC.walkRadius + (DISC.radius - DISC.walkRadius) * grown;
  const stroke = DISC.walkStroke + (DISC.stroke - DISC.walkStroke) * grown;
  return 2 * (radius + stroke);
}

/** "Cafe Sol & The Ox": one line where it fits, so the name stays beside its disc. */
function sharedStopName(names: readonly string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** "1·2", or "5–7" for three stops or more in a row, so the label fits a disc. */
function sharedStopLabel(labels: readonly string[]): string {
  const inRow = labels.every((label, index) => index === 0 || Number(label) === Number(labels[index - 1]) + 1);
  return inRow && labels.length > 2 ? `${labels[0]}–${labels.at(-1)}` : labels.join("·");
}

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
 * Two pubs a few doors apart would stack their discs and hide a number. Stops
 * whose discs would touch at `zoom` share one disc, numbered "1·2" or "5–7" and naming
 * each pub, and part again at a zoom where their discs clear. The shared disc
 * opens its first stop, or `leadId` when that stop is one of its own, so a
 * selected stop keeps its ring.
 */
export function mergeCrowdedRouteStops(
  routeStops: GeoJSON.FeatureCollection,
  zoom: number,
  leadId?: string,
): GeoJSON.FeatureCollection {
  const stops = routeStops.features.filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Point> => feature.geometry?.type === "Point",
  );
  if (stops.length !== routeStops.features.length || !Number.isFinite(zoom)) return routeStops;
  const pixels = stops.map((stop) => worldPixel(stop.geometry.coordinates as LngLat, zoom));
  const widths = stops.map((stop) => routeStopDiscWidth(zoom, stop.properties?.walk === true));
  const group = stops.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index]!)));
  for (let left = 0; left < stops.length; left += 1) {
    for (let right = left + 1; right < stops.length; right += 1) {
      const [lx, ly] = pixels[left]!;
      const [rx, ry] = pixels[right]!;
      const clearance = (widths[left]! + widths[right]!) / 2;
      if (Math.hypot(lx - rx, ly - ry) < clearance) group[root(right)] = root(left);
    }
  }
  const members = new Map<number, number[]>();
  stops.forEach((_, index) => members.set(root(index), [...(members.get(root(index)) ?? []), index]));
  if (members.size === stops.length) return routeStops;
  return {
    ...routeStops,
    features: [...members.values()].map((indexes) => {
      const held = indexes.map((index) => stops[index]!);
      if (held.length === 1) return held[0]!;
      const lead = held.find((stop) => leadId !== undefined && stop.properties?.id === leadId) ?? held[0]!;
      const coords = held.map((stop) => stop.geometry.coordinates);
      return {
        ...lead,
        properties: {
          ...lead.properties,
          label: sharedStopLabel(held.map((stop) => String(stop.properties?.label ?? ""))),
          stopName: sharedStopName(held.map((stop) => String(stop.properties?.stopName ?? ""))),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [0, 1].map((axis) => coords.reduce((sum, coord) => sum + coord[axis]!, 0) / coords.length),
        },
      };
    }),
  };
}
