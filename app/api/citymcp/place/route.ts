// GET /api/citymcp/place?id=...&deep=0|1
//
// Thin CityMCP London `get_place` proxy. Returns the trimmed `CityPlace`
// dossier (identity + optional deep-only enrichment blocks). We NEVER invent
// hygiene scores or ratings — every field surfaces only when the upstream
// gave it to us, with `source` when the upstream attached one.
//
// Fail-soft: any upstream failure lands as 200 + `{ error, place: null }` so
// the venue-sheet dossier strip can degrade silently. A missing `id` is a
// client mistake and returns 400.

import {
  CityMcpError,
  fetchCityPlace,
  type CityPlace,
} from "@/lib/citymcp/client";
import { isCityMcpLimited } from "@/lib/citymcpRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_ID_LEN = 200;
const CACHE_MAX_AGE_S = 120;
const CACHE_STALE_WHILE_REVALIDATE_S = 600;

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

function parseBool(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const GET = withRouteTiming("citymcp/place", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isCityMcpLimited(request)) {
    return jsonResponse({ error: "Too many requests, slow down.", place: null }, { status: 429 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  if (id.length === 0) {
    return jsonResponse({ error: "Place id is missing.", place: null }, { status: 400 });
  }
  if (id.length > MAX_ID_LEN) {
    return jsonResponse({ error: "id is too long.", place: null }, { status: 400 });
  }
  const deep = parseBool(params.get("deep"));

  let place: CityPlace;
  try {
    place = await fetchCityPlace(id, { deep });
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({ place: null, error: message });
  }
  const stale = place.stale === true;
  return jsonResponse(
    { place, ...(stale ? { stale: true } : {}) },
    // Never edge-cache a stale last-known-good dossier.
    { cache: !stale },
  );
}
