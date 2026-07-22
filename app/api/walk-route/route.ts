// GET /api/walk-route?stops=lng,lat;lng,lat;...
//
// Turns an ordered crawl's stop coordinates into ONE drawable LineString that
// follows real walking roads. Per leg: serve the cached routed geometry, else
// route it through OpenRouteService foot-walking (server-side ORS_API_KEY), else
// fall back to the straight segment. Stitched into a single line with a `source`
// flag ("ors" when any leg routed, "straight" when every leg fell back) so the
// map draws it SOLID for real roads and DASHED for the approximate fallback.
//
// ALWAYS 200 with a drawable line (fail-soft, never blocks the map). Keyless is
// the documented default: no ORS_API_KEY ⇒ the straight fallback, no network.
// A GET (stops in the query) keeps this off the social write-surface fence — it
// reads and caches routed geometry, it is not a user-content write.

import { jsonNoStore } from "@/lib/apiResponses";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  legCacheKey,
  legsToLineString,
  parseStops,
  routeSource,
  stopPairs,
  straightLegCoordinates,
  type LngLat,
  type WalkLeg,
} from "@/lib/walkRoute";
import { fetchWalkLeg, orsApiKey } from "@/lib/walkRouteProvider";
import { walkRouteStore } from "@/lib/walkRouteStore";

assertServerEnv();

export const runtime = "nodejs";

// A crawl is 4-7 stops; cap the routable set so a crafted query can't fan out
// into an unbounded burst of ORS calls. Extra stops are dropped, not rejected
// (fail-soft): the returned line still covers the first MAX_STOPS.
export const MAX_STOPS = 12;

const EMPTY_LINE: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

async function resolveLegs(stops: LngLat[]): Promise<WalkLeg[]> {
  const store = walkRouteStore();
  const hasKey = orsApiKey() !== null;
  return Promise.all(
    stopPairs(stops).map(async (pair): Promise<WalkLeg> => {
      const straight: WalkLeg = {
        fromIndex: pair.fromIndex,
        toIndex: pair.toIndex,
        coordinates: straightLegCoordinates(pair.from, pair.to),
        source: "straight",
      };
      const key = legCacheKey(pair.from, pair.to);
      const cached = await store.getLeg(key);
      if (cached) return { ...straight, coordinates: cached, source: "ors" };
      if (!hasKey) return straight;
      const routed = await fetchWalkLeg(pair.from, pair.to);
      if (!routed) return straight;
      await store.putLeg(key, routed);
      return { ...straight, coordinates: routed, source: "ors" };
    }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const stops = parseStops(url.searchParams.get("stops")).slice(0, MAX_STOPS);
  if (stops.length < 2) {
    return jsonNoStore({ line: EMPTY_LINE, source: "straight" });
  }
  const legs = await resolveLegs(stops);
  return jsonNoStore({ line: legsToLineString(legs), source: routeSource(legs) });
}
