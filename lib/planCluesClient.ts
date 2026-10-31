import { PLAN_STOP_MAX, type PlanStopDTO } from "@/lib/plan";
import { discardBody } from "@/lib/responseBody";
import { lineCoordsFromFeatureCollection, stopsParam } from "@/lib/routeMiniMap";
import { isValidLngLat, type LngLat, type WalkLeg } from "@/lib/walkRoute";

/** Public venue and walking reads only. A missing leg cannot acquire a clue. */
export async function loadPlanClueLegs(
  stops: readonly PlanStopDTO[],
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<WalkLeg[]> {
  if (stops.length < 2 || stops.length > PLAN_STOP_MAX || signal.aborted) return [];
  const coordinates = await Promise.all(stops.map(async (stop): Promise<LngLat | null> => {
    try {
      const response = await request(`/api/venue/${encodeURIComponent(stop.venueId)}`, { signal, headers: { accept: "application/json" } });
      if (!response.ok) { discardBody(response); return null; }
      const body = await response.json() as { venue?: { longitude?: unknown; latitude?: unknown } };
      const coordinate = [body.venue?.longitude, body.venue?.latitude];
      return isValidLngLat(coordinate) ? coordinate : null;
    } catch { return null; }
  }));
  if (signal.aborted) return [];
  const legs = await Promise.all(coordinates.slice(1).map(async (to, fromIndex): Promise<WalkLeg | null> => {
    const from = coordinates[fromIndex];
    if (!from || !to || signal.aborted) return null;
    try {
      const response = await request(`/api/walk-route?stops=${encodeURIComponent(stopsParam([from, to]))}`, { signal, headers: { accept: "application/json" } });
      if (!response.ok) { discardBody(response); return null; }
      const body = await response.json() as { line?: unknown; source?: unknown };
      if (body.source !== "ors" || signal.aborted) return null;
      const path = lineCoordsFromFeatureCollection(body.line);
      if (path.length < 2 || !path.every(isValidLngLat)) return null;
      return { fromIndex, toIndex: fromIndex + 1, source: "ors", coordinates: path };
    } catch { return null; }
  }));
  return signal.aborted ? [] : legs.filter((leg): leg is WalkLeg => leg !== null);
}
