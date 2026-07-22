// Pure geometry core for the road-following crawl route. Turns an ordered list
// of stop coordinates into per-leg cache keys, stitches routed (or straight)
// leg geometries into ONE drawable LineString, and owns the straight-line
// fallback each leg degrades to when no router answers. No network, no React,
// no env — trivially unit tested, mirroring lib/routeLegs.ts.
//
// Honesty is the design (same stance as lib/routeLegs.ts): a leg with real
// routed geometry reads as walked pavement; a leg with only its straight segment
// is marked source "straight" so the map can dash it as "approximate, not
// routed" rather than claim a route it never computed. The same honesty carries
// into the leg LABELS: measure a routed leg's real length along its polyline
// (polylineDistanceKm) so it can read "walking route" instead of "straight-line".

import { haversineKm } from "@/lib/haversine";

export type LngLat = [number, number];

export type WalkRouteSource = "ors" | "straight";

export type WalkLeg = {
  /** Index into the ordered stop list of this leg's start. */
  fromIndex: number;
  /** Index into the ordered stop list of this leg's end. */
  toIndex: number;
  /** Ordered path for the leg — >= 2 points, endpoints at (or snapped near) the two stops. */
  coordinates: LngLat[];
  /** "ors" when a router drew the pavement, "straight" for the haversine fallback. */
  source: WalkRouteSource;
};

// Round coordinates to ~1m (5dp is ~1.1m at the equator) for a stable cache key.
// The same ordered stop pair keys to the same leg across reversed/edited routes,
// so a crawl's N-1 legs share the cache and router calls stay far under quota.
export const CACHE_COORD_DP = 5;

export function roundCoord(n: number): number {
  const factor = 10 ** CACHE_COORD_DP;
  return Math.round(n * factor) / factor;
}

/** Stable per-ordered-pair cache key from rounded endpoints (direction matters). */
export function legCacheKey(from: LngLat, to: LngLat): string {
  return `${roundCoord(from[0])},${roundCoord(from[1])}>${roundCoord(to[0])},${roundCoord(to[1])}`;
}

/** The two-point straight segment a leg falls back to with no router geometry. */
export function straightLegCoordinates(from: LngLat, to: LngLat): LngLat[] {
  return [
    [from[0], from[1]],
    [to[0], to[1]],
  ];
}

/** A finite [lng,lat] inside the valid geographic range. */
export function isValidLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    (value[0] as number) >= -180 &&
    (value[0] as number) <= 180 &&
    Number.isFinite(value[1]) &&
    (value[1] as number) >= -90 &&
    (value[1] as number) <= 90
  );
}

/** Encode ordered stops for the walk-route query: `lng,lat;lng,lat;...`. */
export function encodeStops(stops: LngLat[]): string {
  return stops.map(([lng, lat]) => `${lng},${lat}`).join(";");
}

// Decode the `stops` query param. Defensive like decodeCrawl: malformed pairs
// and out-of-range coordinates are dropped, never thrown on. A run of fewer than
// two valid stops yields [] (no drawable leg).
export function parseStops(raw: string | null | undefined): LngLat[] {
  if (!raw) return [];
  const stops: LngLat[] = [];
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [lngRaw, latRaw] = trimmed.split(",");
    const candidate: [number, number] = [Number(lngRaw), Number(latRaw)];
    if (isValidLngLat(candidate)) stops.push(candidate);
  }
  return stops;
}

export type StopPair = {
  fromIndex: number;
  toIndex: number;
  from: LngLat;
  to: LngLat;
};

/** Adjacent stop pairs — N stops yield N-1 legs (mirrors buildRouteLegs). */
export function stopPairs(stops: LngLat[]): StopPair[] {
  const pairs: StopPair[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    pairs.push({ fromIndex: i, toIndex: i + 1, from: stops[i], to: stops[i + 1] });
  }
  return pairs;
}

/** The all-straight leg set — the keyless fail-soft base every route starts from. */
export function straightLegs(stops: LngLat[]): WalkLeg[] {
  return stopPairs(stops).map((pair) => ({
    fromIndex: pair.fromIndex,
    toIndex: pair.toIndex,
    coordinates: straightLegCoordinates(pair.from, pair.to),
    source: "straight" as const,
  }));
}

// Join per-leg coordinate runs into one continuous path, dropping the duplicated
// shared vertex where a leg's end meets the next leg's start (otherwise the
// route carries a doubled point at every stop).
export function stitchLegCoordinates(legs: LngLat[][]): LngLat[] {
  const out: LngLat[] = [];
  for (const leg of legs) {
    for (const coord of leg) {
      const last = out[out.length - 1];
      if (last && last[0] === coord[0] && last[1] === coord[1]) continue;
      out.push(coord);
    }
  }
  return out;
}

// The whole line reads as "ors" (solid) when ANY leg was routed, and only
// "straight" (dashed) when EVERY leg fell back — a single MapLibre line source
// carries one style, and honesty tolerates a mixed route reading as routed as
// long as a fully-approximate one is never dressed up as pavement.
export function routeSource(legs: WalkLeg[]): WalkRouteSource {
  return legs.some((leg) => leg.source === "ors") ? "ors" : "straight";
}

// Real walked distance in km along a drawn polyline: the sum of the great-circle
// hops between its consecutive points. For a straight two-point leg this equals
// the haversine distance between the stops; for an ORS pavement leg it is the
// TRUE routed length (always >= the straight-line distance), which is exactly
// what lets a leg label read an honest "walking route" instead of "straight-
// line". Fewer than two points measures nothing (0).
export function polylineDistanceKm(coordinates: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    km += haversineKm(coordinates[i - 1], coordinates[i]);
  }
  return km;
}

/** A leg's measured distance + how it was drawn — the serializable per-leg
 *  distance breakdown GET /api/walk-route returns so a client can relabel each
 *  leg source-aware (see lib/routeLegs withRoutedDistances). */
export type WalkLegDistance = {
  fromIndex: number;
  toIndex: number;
  /** Distance in km along this leg's drawn polyline (routed length or straight). */
  distanceKm: number;
  source: WalkRouteSource;
};

/** Per-leg measured distances, in leg order — polylineDistanceKm per leg. */
export function legDistances(legs: WalkLeg[]): WalkLegDistance[] {
  return legs.map((leg) => ({
    fromIndex: leg.fromIndex,
    toIndex: leg.toIndex,
    distanceKm: polylineDistanceKm(leg.coordinates),
    source: leg.source,
  }));
}

// Stitch legs into ONE GeoJSON FeatureCollection whose single LineString feature
// carries a `source` property. Shape matches geojson.ts routeToLine so it drops
// straight into routeLineRef. Fewer than two stitched points yields an empty
// collection (nothing to draw), same as routeToLine on a single stop.
export function legsToLineString(legs: WalkLeg[]): GeoJSON.FeatureCollection {
  const coordinates = stitchLegCoordinates(legs.map((leg) => leg.coordinates));
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { source: routeSource(legs) },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}
