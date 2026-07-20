import { publicApiError } from "@/lib/apiError";
import {
  isNightOutPlaceJob,
  placesForNightOutJob,
} from "@/lib/nightOutPlaces";
import { loadNightOutPlaceSnapshot } from "@/lib/nightOutPlaces.server";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 1_800;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_RADIUS_KM = 1.5;
const MAX_RADIUS_KM = 5;

function finiteParam(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inLondon(lat: number, lng: number): boolean {
  return lat >= 51.26 && lat <= 51.72 && lng >= -0.55 && lng <= 0.3;
}

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    headers: {
      "cache-control": `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`,
    },
  });
}

export const GET = withRouteTiming("night-out-places", getHandler);

async function getHandler(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const job = params.get("job")?.trim() ?? "";
  if (!isNightOutPlaceJob(job)) {
    return publicApiError(
      "Choose food near a pub or an attraction before the pub.",
      "INVALID_NIGHT_OUT_JOB",
      400,
    );
  }

  const lat = finiteParam(params.get("lat"));
  const lng = finiteParam(params.get("lng"));
  if (lat === null || lng === null || !inLondon(lat, lng)) {
    return publicApiError(
      "A valid London anchor is required.",
      "INVALID_LONDON_ANCHOR",
      400,
    );
  }

  const requestedLimit = finiteParam(params.get("limit"));
  const requestedRadius = finiteParam(params.get("radiusKm"));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(requestedLimit ?? DEFAULT_LIMIT)),
  );
  const radiusKm = Math.min(
    MAX_RADIUS_KM,
    Math.max(0.1, requestedRadius ?? DEFAULT_RADIUS_KM),
  );
  const snapshot = loadNightOutPlaceSnapshot();
  const places = placesForNightOutJob(snapshot.places, {
    job,
    lat,
    lng,
    radiusKm,
    limit,
    now: new Date(),
  });

  return jsonResponse({
    status: places.length > 0 ? "ready" : "empty",
    job,
    anchor: { lat, lng, radiusKm },
    observedThrough: snapshot.generatedAt,
    places,
    ...(places.length === 0
      ? { message: "No sourced spots have cleared our checks near here yet." }
      : {}),
  });
}
