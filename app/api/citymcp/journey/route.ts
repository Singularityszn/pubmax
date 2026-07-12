// GET /api/citymcp/journey?fromLat=&fromLng=&toLat=&toLng=&limit=
//
// Thin CityMCP London `get_journey` proxy. Coords are formatted as the
// `"lat,lng"` strings the upstream expects (free-text names often Ambiguous).
// Returns a short list of trimmed TfL itineraries for the crawl RoutePanel.
//
// Fail-soft: any upstream failure lands as 200 + `{ error, journeys: [] }`.
// Missing / out-of-range coords are a client mistake and return 400.

import {
  CityMcpError,
  fetchJourney,
  formatJourneyPoint,
  type CityJourney,
} from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;
const CACHE_MAX_AGE_S = 120;
const CACHE_STALE_WHILE_REVALIDATE_S = 600;

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

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
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

export async function GET(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return jsonResponse(
      { error: "Too many requests, slow down.", from: null, to: null, journeys: [] },
      { status: 429 },
    );
  }

  const params = new URL(request.url).searchParams;

  const fromLat = parseCoord(params.get("fromLat"));
  const fromLng = parseCoord(params.get("fromLng"));
  const toLat = parseCoord(params.get("toLat"));
  const toLng = parseCoord(params.get("toLng"));

  if (
    fromLat === null ||
    fromLng === null ||
    toLat === null ||
    toLng === null
  ) {
    return jsonResponse(
      {
        error: "fromLat, fromLng, toLat, and toLng are required.",
        from: null,
        to: null,
        journeys: [],
      },
      { status: 400 },
    );
  }

  if (!isUkLatLng(fromLat, fromLng) || !isUkLatLng(toLat, toLng)) {
    return jsonResponse(
      {
        error: "Coordinates must be within the UK (lat 49–61, lng −8…2).",
        from: null,
        to: null,
        journeys: [],
      },
      { status: 400 },
    );
  }

  const from = formatJourneyPoint(fromLat, fromLng);
  const to = formatJourneyPoint(toLat, toLng);
  const limit = parseLimit(params.get("limit"));

  let journeys: CityJourney[];
  try {
    const result = await fetchJourney({ from, to });
    journeys = result.journeys.slice(0, limit);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({
      from,
      to,
      journeys: [],
      asOf: null,
      error: message,
    });
  }

  return jsonResponse(
    {
      from,
      to,
      journeys,
      asOf: null,
    },
    { cache: true },
  );
}
