import type * as maplibregl from "maplibre-gl";
import { pubHitOf } from "./pubHitPriority";

export const LANDMARK_INTERACTION_LAYERS = ["landmarks-icon", "landmarks-label"] as const;
export const CLUSTER_RIM_LAYERS = ["cluster-count-badge", "clusters-casing"] as const;

export const PUB_FIRST_LAYERS = [
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
