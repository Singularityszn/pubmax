// GET /api/citymcp/places?q=...&limit=5
//
// Thin CityMCP London `search_places` proxy. Returns a small array of place
// rows for scanning — never the full Google Places dossier. Fail-soft:
// upstream errors surface as a 200 with `{ error, places: [] }` (except a
// missing/invalid `q`, which is a client mistake and gets a 400).

import {
  CityMcpError,
  searchCityPlaces,
  type SearchPlacesRow,
} from "@/lib/citymcp/client";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_QUERY_LEN = 200;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function thinRow(row: SearchPlacesRow): SearchPlacesRow {
  // Only return fields we've documented as safe for the UI. Especially, do NOT
  // invent hygiene scores or Order URLs (see task constraints); those come
  // from `get_place` with deep:true if we ever need them.
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    location: row.location,
    types: Array.isArray(row.types) ? row.types.slice(0, 6) : undefined,
    rating: typeof row.rating === "number" ? row.rating : undefined,
    userRatingCount:
      typeof row.userRatingCount === "number" ? row.userRatingCount : undefined,
    priceBand: row.priceBand,
    openNow: row.openNow,
  };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (q.length === 0) {
    return jsonResponse({ error: "q is required." }, 400);
  }
  if (q.length > MAX_QUERY_LEN) {
    return jsonResponse({ error: "q is too long." }, 400);
  }
  const limit = parseLimit(params.get("limit"));

  try {
    const places = await searchCityPlaces(q, { limit });
    return jsonResponse({ places: places.map(thinRow) });
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonResponse({ places: [], error: message });
  }
}
