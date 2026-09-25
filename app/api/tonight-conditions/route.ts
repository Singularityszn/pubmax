// GET /api/tonight-conditions?lat=..&lng=..  →  { summary: TonightConditionsSummary | null }
//
// The server half of the Tonight Conditions strip. Reads the cached night-area
// weather snapshot (public/data/weather/latest.json, the same seam the plan
// generator consumes), runs the pure drink-weather rules, and — when the viewer
// shares a rough location — counts nearby venues matching the verdict's lens
// from the bundled venue index (beer gardens via the amenity flag, riverside via
// the nearWater curation flag) with a pint under the price ceiling.
//
// lat/lng are OPTIONAL. Without them we still answer with the date, weather and
// drink line for a sensible central area, just no "near you" venue claim. No
// reading for the area answers { summary: null }, which the strip and the chip
// say plainly; a read that throws answers a retryable 503, which they hide.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiErrorFromStatus } from "@/lib/apiError";
import { coarsenViewerPoint } from "@/lib/geo";
import { resolveTonightConditions } from "@/lib/tonightConditionsRoute";

function finiteCoord(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const lat = finiteCoord(url.searchParams.get("lat"), -90, 90);
    const lng = finiteCoord(url.searchParams.get("lng"), -180, 180);
    const viewerPoint = lat !== null && lng !== null
      ? coarsenViewerPoint({ lat, lng })
      : null;
    const point: [number, number] | null = viewerPoint
      ? [viewerPoint.lng, viewerPoint.lat]
      : null;

    const summary = await resolveTonightConditions({ point, now: new Date() });
    return jsonNoStore({ summary });
  } catch {
    return publicApiErrorFromStatus("Tonight's conditions are unavailable.", 503);
  }
}
