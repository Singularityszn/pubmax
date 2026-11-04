// GET /api/leg-options?from=lat,lng&to=lat,lng
//
// Ways to get from one stop of a night to the next: walk, tube, bus and the
// rest of TfL, each with its time, TfL's own fare (or none listed) and its
// exact path, with the fastest and the cheapest marked (lib/legOptions.ts).
// Both ends are pubs on the reader's plan, never the reader's own position, so
// no location leaves the device. London only: TfL plans London.
//
// The answer is "leave now" and changes with the timetable, so it is never
// shared-cached. The per-IP floor is the TfL surfaces' own (last-ride), under
// its own scope, so a burst here cannot spend the last-train allowance.

import { publicApiError } from "@/lib/apiError";
import { CITIES, pointInCityBounds } from "@/lib/cities";
import { isLastRideLimited } from "@/lib/lastRideRateLimit";
import type { LegOptionsResponse } from "@/lib/legOptions";
import { fetchLegOptions } from "@/lib/tflLegOptions.server";

export const runtime = "nodejs";
// Seconds, and a literal: Next reads route segment config by static analysis.
export const maxDuration = 15;

/** Each TfL question gets this long; both are asked at once. */
const TFL_TIMEOUT_MS = 8_000;

function json(body: LegOptionsResponse): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

function parsePoint(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const [latRaw, lngRaw, extra] = raw.split(",");
  if (extra !== undefined) return null;
  const lat = Number.parseFloat(latRaw ?? "");
  const lng = Number.parseFloat(lngRaw ?? "");
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const from = parsePoint(params.get("from"));
  const to = parsePoint(params.get("to"));
  if (!from || !to) {
    return publicApiError("Add valid from and to points as lat,lng.", "INVALID_REQUEST", 400);
  }
  if (!pointInCityBounds(from.lat, from.lng, CITIES.london) || !pointInCityBounds(to.lat, to.lng, CITIES.london)) {
    return json({ status: "unavailable", options: [] });
  }
  if (await isLastRideLimited(request, "leg-options")) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const options = await fetchLegOptions(from, to, { timeoutMs: TFL_TIMEOUT_MS, signal: request.signal });
  if (!options || options.length === 0) return json({ status: "unavailable", options: [] });
  return json({ status: "ok", options });
}
