// OpenRouteService foot-walking provider — the keyed half of the road-route
// chain. Given two stop coordinates it returns the real pavement geometry ORS
// draws between them, or null so the caller draws the straight segment instead.
//
// KEYS: ORS_API_KEY, SERVER-SIDE ONLY. Absent ⇒ this returns null WITHOUT any
// network call (the documented keyless fail-soft default the test doctrine
// exercises — see lib/weatherProvider.ts for the same keyless-fetcher shape).
// Because the fetch is server-side, the key never ships to the browser and no
// CSP connect-src edit is needed (api.openrouteservice.org is reached from our
// own server, not the client).
//
// EVERY failure is soft: a missing key, a non-200, a malformed payload, a
// network error or an abort all resolve to null. A leg that cannot be routed
// falls back to its straight segment; the map never breaks.

import { isValidLngLat, type LngLat } from "@/lib/walkRoute";

/** The GeoJSON directions endpoint — returns a LineString FeatureCollection. */
export const ORS_FOOT_WALKING_URL =
  "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";

/** Trimmed ORS_API_KEY, or null when unset/blank (the keyless default). */
export function orsApiKey(): string | null {
  const key = process.env.ORS_API_KEY?.trim();
  return key ? key : null;
}

/** Injectable fetch so route/provider tests stay hermetic (no live network). */
export type WalkRouteFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetch: WalkRouteFetch = (url, init) => fetch(url, init);

// Pull the LineString coordinates out of an ORS GeoJSON directions response.
// ORS coordinates are [lng, lat] (optionally with an elevation third element —
// we take the first two). Returns null unless at least two valid points parse.
function parseOrsGeometry(body: unknown): LngLat[] | null {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const geometry = (features[0] as { geometry?: { type?: unknown; coordinates?: unknown } } | null)
    ?.geometry;
  if (!geometry || geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  const coords: LngLat[] = [];
  for (const point of geometry.coordinates) {
    if (!Array.isArray(point)) continue;
    const candidate: [number, number] = [Number(point[0]), Number(point[1])];
    if (isValidLngLat(candidate)) coords.push(candidate);
  }
  return coords.length >= 2 ? coords : null;
}

export type FetchWalkLegOptions = {
  /** Explicit key (tests). Omit to read ORS_API_KEY; null forces the keyless path. */
  apiKey?: string | null;
  doFetch?: WalkRouteFetch;
  signal?: AbortSignal;
};

// Fetch the routed pavement geometry for ONE leg (two ordered stops). Resolves
// to the [lng,lat] path on success, or null on any soft failure (no key,
// non-200, malformed payload, network error, abort) so the caller draws the
// straight segment for that leg.
export async function fetchWalkLeg(
  from: LngLat,
  to: LngLat,
  opts: FetchWalkLegOptions = {},
): Promise<LngLat[] | null> {
  const apiKey = opts.apiKey === undefined ? orsApiKey() : opts.apiKey;
  if (!apiKey) return null;
  const doFetch = opts.doFetch ?? defaultFetch;
  try {
    const response = await doFetch(ORS_FOOT_WALKING_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [from[0], from[1]],
          [to[0], to[1]],
        ],
      }),
      signal: opts.signal,
    });
    if (!response.ok) return null;
    return parseOrsGeometry(await response.json());
  } catch {
    // Network error, abort, or a JSON parse throw — all degrade to straight.
    return null;
  }
}
