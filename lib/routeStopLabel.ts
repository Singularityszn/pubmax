// Route-stop plaque labels: the pub name that rides beside each numbered stop.
// A long name ("The Old Bank of England") is truncated so it never sprawls
// across the route; the ellipsis signals there's more. Trim first so trailing
// spaces don't eat the budget, and drop a trailing space before the ellipsis so
// we never emit "word …".
import type { ExpressionSpecification } from "maplibre-gl";

export const ROUTE_STOP_LABEL_MAX = 18;

/** Keep the endpoint's name inside the framed route, including fallback anchors. */
export const ROUTE_STOP_NAME_ANCHOR_OFFSET = [
  "match",
  ["get", "labelSide"],
  "west",
  ["literal", ["right", [-1.6, 0], "top-right", [0.6, 2], "bottom-right", [0.6, -2]]],
  ["literal", ["left", [1.6, 0], "top-left", [-0.6, 2], "bottom-left", [-0.6, -2]]],
] satisfies ExpressionSpecification;

/** Turn names inward after a pan or rotation without moving the camera. */
export function orientRouteStopLabels(
  stops: GeoJSON.FeatureCollection,
  projectX: (point: [number, number]) => number,
  centerX: number,
): GeoJSON.FeatureCollection {
  let changed = false;
  const features = stops.features.map((feature) => {
    if (feature.geometry.type !== "Point") return feature;
    const [lng, lat] = feature.geometry.coordinates;
    if (lng === undefined || lat === undefined) return feature;
    const labelSide = projectX([lng, lat]) > centerX ? "west" : "east";
    if (feature.properties?.labelSide === labelSide) return feature;
    changed = true;
    return { ...feature, properties: { ...feature.properties, labelSide } };
  });
  return changed ? { ...stops, features } : stops;
}

export function truncateStopName(
  name: string,
  max = ROUTE_STOP_LABEL_MAX,
): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve one slot for the single-glyph ellipsis.
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
