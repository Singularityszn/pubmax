import type * as maplibregl from "maplibre-gl";
import { pubHitOf } from "./pubHitPriority";

export const LANDMARK_INTERACTION_LAYERS = ["landmarks-icon", "landmarks-label"] as const;

// The disc's casing and the count on its rim stand on the `clusters` circle's
// own edge and overhang it, so a tap on the outer part of either is a tap on the
// cluster. All three carry the same `cluster_id`.
export const CLUSTER_RIM_LAYERS = ["cluster-count-badge", "clusters-casing"] as const;

// Pub-first hit testing: a single map click queries pubs/route stops before
// landmarks/POIs so dense central London taps open a pub sheet, not a
// landmark card that happened to sit under the same finger.
// `uk-base-point` sits AFTER the curated pub layers and before the ambient
// ones: an unverified pub is still a pub (so it beats a landmark or a station
// under the same thumb), but where a curated pin and a base pin overlap the
// curated one wins — the same precedence the paint order states. A London
// restaurant comes after the base pubs for the same reason: it is drawn under
// them.
export const PUB_FIRST_LAYERS = [
  "pubs-price-pill-selected",
  "pubs-point-selected",
  "pubs-price-pill",
  "pubs-point",
  "route-stops",
  "tonight-point",
  "clusters",
  ...CLUSTER_RIM_LAYERS,
  "coffee-pilot-point",
  "uk-base-point",
  "uk-base-unnamed-point",
  "london-restaurant-point",
  ...LANDMARK_INTERACTION_LAYERS,
  "pois-dot",
  "pois-transport-major",
  "pois-transport-minor",
] as const;

const CLICK_BRANCHES = [
  ["route-stops", "route"],
  ["clusters", "cluster"],
  ...CLUSTER_RIM_LAYERS.map((layer) => [layer, "cluster"] as const),
  ["coffee-pilot-point", "cafe"],
  ["uk-base-point", "base"],
  ["uk-base-unnamed-point", "base"],
  ["london-restaurant-point", "restaurant"],
  ["tonight-point", "tonight"],
  ...LANDMARK_INTERACTION_LAYERS.map((layer) => [layer, "landmark"] as const),
  ["pois-dot", "poi"],
  ["pois-transport-major", "poi"],
  ["pois-transport-minor", "poi"],
] as const;

export function resolveClickHit(features: readonly maplibregl.MapGeoJSONFeature[]) {
  const byLayer = new Map<string, maplibregl.MapGeoJSONFeature>();
  for (const feature of features) {
    const layerId = feature.layer?.id;
    if (typeof layerId === "string" && !byLayer.has(layerId)) byLayer.set(layerId, feature);
  }
  const pub = pubHitOf(byLayer);
  if (pub) return { kind: "pub" as const, feature: pub };
  for (const [layer, kind] of CLICK_BRANCHES) {
    const feature = byLayer.get(layer);
    if (feature) return { kind, feature };
  }
  return undefined;
}
