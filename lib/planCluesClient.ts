import { PLAN_STOP_MAX, type PlanStopDTO } from "@/lib/plan";
import { discardBody } from "@/lib/responseBody";
import { lineCoordsFromFeatureCollection, stopsParam } from "@/lib/routeMiniMap";
import { isValidLngLat, type LngLat, type WalkLeg } from "@/lib/walkRoute";

const PUBLIC_REQUEST_DEADLINE_MS = 8_000;

/** The deadline covers headers and JSON, including transports that ignore abort. */
async function publicJson(url: string, parentSignal: AbortSignal, request: typeof fetch): Promise<Record<string, unknown> | null> {
  if (parentSignal.aborted) return null;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => { controller.abort(); resolve(null); };
    parentSignal.addEventListener("abort", cancel, { once: true });
    timeout = setTimeout(cancel, PUBLIC_REQUEST_DEADLINE_MS);
  });
  const read = async (): Promise<Record<string, unknown> | null> => {
    const response = await request(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (controller.signal.aborted || !response.ok) { discardBody(response); return null; }
    const body: unknown = await response.json();
    if (controller.signal.aborted || !body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  };
  try {
    return await Promise.race([read(), cancelled]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", cancel);
  }
}

/** Public venue and walking reads only. A missing leg cannot acquire a clue. */
export async function loadPlanClueLegs(
  stops: readonly PlanStopDTO[],
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<WalkLeg[]> {
  if (stops.length < 2 || stops.length > PLAN_STOP_MAX || signal.aborted) return [];
  const coordinates = await Promise.all(stops.map(async (stop): Promise<LngLat | null> => {
    const body = await publicJson(`/api/venue/${encodeURIComponent(stop.venueId)}`, signal, request);
    if (!body?.venue || typeof body.venue !== "object" || Array.isArray(body.venue)) return null;
    const venue = body.venue as Record<string, unknown>;
    const coordinate = [venue.longitude, venue.latitude];
    return isValidLngLat(coordinate) ? coordinate : null;
  }));
  if (signal.aborted) return [];
  const legs = await Promise.all(coordinates.slice(1).map(async (to, fromIndex): Promise<WalkLeg | null> => {
    const from = coordinates[fromIndex];
    if (!from || !to || signal.aborted) return null;
    const body = await publicJson(`/api/walk-route?stops=${encodeURIComponent(stopsParam([from, to]))}`, signal, request);
    if (body?.source !== "ors" || signal.aborted) return null;
    const path = lineCoordsFromFeatureCollection(body.line);
    if (path.length < 2 || !path.every(isValidLngLat)) return null;
    return { fromIndex, toIndex: fromIndex + 1, source: "ors", coordinates: path };
  }));
  return signal.aborted ? [] : legs.filter((leg): leg is WalkLeg => leg !== null);
}
