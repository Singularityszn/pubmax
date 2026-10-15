// GET  /api/citymcp/journey?fromLat=&fromLng=&toLat=&toLng=&limit=
// GET  /api/citymcp/journey?stops=lat,lng;lat,lng;...&limit=   (one crawl, every leg)
// POST /api/citymcp/journey { fromLat, fromLng, toLat, toLng, limit }
//
// Thin CityMCP London `get_journey` proxy. Coords are formatted as the
// `"lat,lng"` strings the upstream expects (free-text names often Ambiguous).
// GET is for public venue-to-venue crawl legs and may be CDN cached. POST is
// for a viewer's location: coordinates stay out of URLs and every response is
// private/no-store.
//
// The `stops` GET is the Crawl Route lane (F10): one request answers every leg
// between consecutive Crawl Stops, so a crawl pays one function invocation and
// one rate-limit check instead of one per leg, and one CDN key per route. The
// caller rounds each stop to 4 decimals (~11 m) so the key repeats.
//
// Fail-soft: any upstream failure lands as 200 + `{ error, journeys: [] }`
// (per leg in the `stops` lane). Missing / out-of-range coords are a client
// mistake and return 400.

import { publicApiError } from "@/lib/apiError";
import {
  CityMcpError,
  fetchJourney,
  formatJourneyPoint,
  type CityJourney,
} from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { coarsenViewerPoint } from "@/lib/geo";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;
const CACHE_MAX_AGE_S = 120;
const CACHE_STALE_WHILE_REVALIDATE_S = 600;

/** A Crawl Route maps at most WALK_ROUTE_MAX_STOPS (12) stops, so 11 legs. */
const MAX_STOPS = 12;
/** Legs asked of CityMCP at once, so one crawl never stampedes the upstream. */
const LEG_CONCURRENCY = 4;
/** Per-leg upstream ceiling: three rounds of four legs stay inside maxDuration. */
const LEG_TIMEOUT_MS = 4_000;

/** Rough UK bounding box — enough to reject clearly bad coords. */
const LAT_MIN = 49;
const LAT_MAX = 61;
const LNG_MIN = -8;
const LNG_MAX = 2;

function jsonResponse(
  body: unknown,
  opts: { status?: number; cache?: boolean } = {},
): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

function parseLimit(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseCoord(raw: unknown): number | null {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isUkLatLng(lat: number, lng: number): boolean {
  return (
    lat >= LAT_MIN &&
    lat <= LAT_MAX &&
    lng >= LNG_MIN &&
    lng <= LNG_MAX
  );
}

type JourneyInput = {
  fromLat?: unknown;
  fromLng?: unknown;
  toLat?: unknown;
  toLng?: unknown;
  limit?: unknown;
};

async function respondWithJourney(
  request: Request,
  input: JourneyInput,
  options: { cache: boolean; exposePoints: boolean; viewerOrigin: boolean },
): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { from: null, to: null, journeys: [] },
    });
  }

  const fromLat = parseCoord(input.fromLat);
  const fromLng = parseCoord(input.fromLng);
  const toLat = parseCoord(input.toLat);
  const toLng = parseCoord(input.toLng);

  if (
    fromLat === null ||
    fromLng === null ||
    toLat === null ||
    toLng === null
  ) {
    return publicApiError("Add valid start and end coordinates.", "INVALID_REQUEST", 400, {
      compatibilityFields: { from: null, to: null, journeys: [] },
    });
  }

  if (!isUkLatLng(fromLat, fromLng) || !isUkLatLng(toLat, toLng)) {
    return publicApiError("Coordinates must be within the UK (lat 49–61, lng −8…2).", "INVALID_REQUEST", 400, {
      compatibilityFields: { from: null, to: null, journeys: [] },
    });
  }

  // `viewerOrigin` is the POST lane and only the POST lane: a request that
  // starts where the READER is stands is sent as a body with `cache: no-store`
  // (components/map/useVenueJourney.ts), so a viewer point never reaches this
  // route's URL and never reaches the shared cache key. The cacheable GET
  // carries venue-to-venue coordinates, which are public map data.
  const fromPoint = options.viewerOrigin
    ? coarsenViewerPoint({ lat: fromLat, lng: fromLng })
    : { lat: fromLat, lng: fromLng };
  const from = formatJourneyPoint(fromPoint.lat, fromPoint.lng);
  const to = formatJourneyPoint(toLat, toLng);
  const limit = parseLimit(input.limit);

  let journeys: CityJourney[];
  try {
    const result = await fetchJourney(
      { from, to },
      { cache: options.cache },
    );
    journeys = result.journeys.slice(0, limit);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({
      ...(options.exposePoints ? { from, to } : {}),
      journeys: [],
      asOf: null,
      error: message,
    });
  }

  return jsonResponse(
    {
      ...(options.exposePoints ? { from, to } : {}),
      journeys,
      asOf: null,
    },
    { cache: options.cache },
  );
}

type CrawlLegAnswer = { journeys: CityJourney[]; error?: string };

/** Parse `lat,lng;lat,lng;...` into UK points, or null when any stop is bad. */
function parseStops(raw: string): Array<{ lat: number; lng: number }> | null {
  const parts = raw.split(";");
  if (parts.length < 2 || parts.length > MAX_STOPS) return null;
  const stops: Array<{ lat: number; lng: number }> = [];
  for (const part of parts) {
    const [latRaw, lngRaw, extra] = part.split(",");
    if (extra !== undefined) return null;
    const lat = parseCoord(latRaw);
    const lng = parseCoord(lngRaw);
    if (lat === null || lng === null || !isUkLatLng(lat, lng)) return null;
    stops.push({ lat, lng });
  }
  return stops;
}

async function respondWithCrawlLegs(request: Request, params: URLSearchParams): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { legs: [] },
    });
  }

  const stops = parseStops(params.get("stops") ?? "");
  if (!stops) {
    return publicApiError(
      `Add 2 to ${MAX_STOPS} UK stops as lat,lng separated by semicolons.`,
      "INVALID_REQUEST",
      400,
      { compatibilityFields: { legs: [] } },
    );
  }

  const limit = parseLimit(params.get("limit"));
  const points = stops.map((stop) => formatJourneyPoint(stop.lat, stop.lng));
  const legs: CrawlLegAnswer[] = new Array(points.length - 1);
  for (let start = 0; start < legs.length; start += LEG_CONCURRENCY) {
    const end = Math.min(start + LEG_CONCURRENCY, legs.length);
    await Promise.all(
      Array.from({ length: end - start }, async (_, offset) => {
        const index = start + offset;
        try {
          const result = await fetchJourney(
            { from: points[index]!, to: points[index + 1]! },
            { cache: true, timeoutMs: LEG_TIMEOUT_MS, retries: 0 },
          );
          legs[index] = { journeys: result.journeys.slice(0, limit) };
        } catch (err) {
          legs[index] = {
            journeys: [],
            error: err instanceof CityMcpError ? err.message : "CityMCP request failed",
          };
        }
      }),
    );
  }

  // A route with a failed leg is not pinned at the edge: the next request
  // retries it rather than reading the hole for the next two minutes.
  const complete = legs.every((leg) => leg.error === undefined);
  return jsonResponse({ legs, asOf: null }, { cache: complete });
}

export const GET = withRouteTiming("citymcp/journey", getHandler);

async function getHandler(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.has("stops")) return respondWithCrawlLegs(request, params);
  return respondWithJourney(
    request,
    {
      fromLat: params.get("fromLat"),
      fromLng: params.get("fromLng"),
      toLat: params.get("toLat"),
      toLng: params.get("toLng"),
      limit: params.get("limit"),
    },
    { cache: true, exposePoints: true, viewerOrigin: false },
  );
}

export const POST = withRouteTiming("citymcp/journey", postHandler);

async function postHandler(request: Request): Promise<Response> {
  let input: JourneyInput;
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    input = body as JourneyInput;
  } catch {
    return publicApiError("Add a JSON travel request.", "INVALID_REQUEST", 400, {
      compatibilityFields: { journeys: [] },
    });
  }

  return respondWithJourney(
    request,
    input,
    { cache: false, exposePoints: false, viewerOrigin: true },
  );
}
