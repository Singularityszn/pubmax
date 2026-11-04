// Which sun dots the map draws. A dot belongs beside a pub's pin, so it is
// drawn only while the map is drawing that pin: a pin that lost symbol
// collision, or a pub folded into a cluster, takes its dot with it. Kept apart
// from the map layer so the rule can be tested without a map.

import type * as maplibregl from "maplibre-gl";
import { segmentAt, type SunEstimate } from "@/lib/sunChaser";

/** The pub pin layers, as the click router and the painted-pin probe name them. */
export const PUB_PIN_LAYERS = [
  "pubs-price-pill-selected",
  "pubs-point-selected",
  "pubs-price-pill",
  "pubs-point",
] as const;

/**
 * The ids of the pub pins the map is drawing right now. Rendered-feature
 * queries return placed symbols only, so a pin that lost collision is absent.
 */
export function paintedPinIds(map: Pick<maplibregl.Map, "getLayer" | "queryRenderedFeatures">): Set<string> {
  const layers = PUB_PIN_LAYERS.filter((id) => Boolean(map.getLayer(id)));
  const ids = new Set<string>();
  if (layers.length === 0) return ids;
  for (const feature of map.queryRenderedFeatures({ layers })) {
    const id = feature.properties?.id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** Same members, so a settled map that drew the same pins asks for no new dots. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** The dots to draw: likely in sun at `at`, and beside a pin the map is drawing. */
export function sunDotFeatures(
  estimates: ReadonlyMap<string, SunEstimate>,
  at: Date | null,
  pointOf: (id: string) => readonly [number, number] | null,
  paintedIds: ReadonlySet<string>,
): GeoJSON.Feature<GeoJSON.Point>[] {
  if (!at) return [];
  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const [id, estimate] of estimates) {
    if (!paintedIds.has(id)) continue;
    if (estimate.kind !== "estimate" || segmentAt(estimate.timeline, at)?.state !== "sun") continue;
    const point = pointOf(id);
    if (!point) continue;
    out.push({ type: "Feature", properties: { id }, geometry: { type: "Point", coordinates: [point[0], point[1]] } });
  }
  return out;
}
