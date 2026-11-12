// Which sun dots the map draws. A dot belongs beside a pub's pin, so it is
// drawn only while the map is drawing that pin (canvas/paintedPins.ts). Kept
// apart from the map layer so the rule can be tested without a map.

import { segmentAt, type SunEstimate } from "@/lib/sunChaser";

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
