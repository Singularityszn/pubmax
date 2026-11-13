// The UK base layer seen from above its zoom gate: one point per published
// shard with the number of pubs and bars in it, clustered by MapLibre into
// count bubbles (components/map/canvas/ukBaseOverviewLayers.ts).
//
// Below UK_BASE_MIN_ZOOM no shard is fetched, so this ~4 KB file is what stops
// the zoomed-out country reading as empty. It is fetched once, only after the
// camera first goes below the gate and the priced pins have painted.
// scripts/build_uk_base_overview.mjs writes it from the published shards.
//
// A count is a count of OSM places, never of prices. Where the curated layer
// draws its own clusters, the overview stands down so one area never shows two
// bubbles.

import type { MapBounds } from "@/lib/slimShards";
import { discardBody } from "@/lib/responseBody";

const UK_BASE_OVERVIEW_PATH = "/data/uk_base/overview.json";
const UK_BASE_OVERVIEW_VERSION = 1;

export type UkBaseOverviewPoint = { lat: number; lng: number; count: number };

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function isOverviewRow(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    Number.isFinite(value[0]) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    Number.isFinite(value[1]) &&
    value[1] >= -180 &&
    value[1] <= 180 &&
    Number.isInteger(value[2]) &&
    value[2] > 0
  );
}

/** Null when the file is not the overview this client reads. */
export function parseUkBaseOverview(value: unknown): UkBaseOverviewPoint[] | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, cells } = value as { version?: unknown; cells?: unknown };
  if (version !== UK_BASE_OVERVIEW_VERSION || !Array.isArray(cells)) return null;
  if (!cells.every(isOverviewRow)) return null;
  return cells.map(([lat, lng, count]) => ({ lat, lng, count }));
}

function inside(point: UkBaseOverviewPoint, bounds: MapBounds): boolean {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}

/**
 * The overview's GeoJSON. `curatedBounds` is the area the curated layer is
 * drawing clusters over; a point inside it is left out.
 */
export function ukBaseOverviewToGeoJSON(
  points: readonly UkBaseOverviewPoint[],
  curatedBounds: MapBounds | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const point of points) {
    if (curatedBounds && inside(point, curatedBounds)) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: { n: point.count },
    });
  }
  return features.length > 0 ? { type: "FeatureCollection", features } : EMPTY;
}

let overviewPromise: Promise<UkBaseOverviewPoint[] | null> | null = null;

/** One read per session. A failed read is not kept, so the next zoom-out retries. */
export function loadUkBaseOverview(): Promise<UkBaseOverviewPoint[] | null> {
  if (!overviewPromise) {
    overviewPromise = fetch(UK_BASE_OVERVIEW_PATH)
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          return null;
        }
        return parseUkBaseOverview(await response.json());
      })
      .catch(() => null)
      .then((points) => {
        if (!points) overviewPromise = null;
        return points;
      });
  }
  return overviewPromise;
}

/**
 * The area the curated clusters cover: the loaded city's box while any curated
 * venue is drawable, or null when the curated layer draws nothing.
 */
export function curatedClusterBounds(
  cityBounds: [[number, number], [number, number]],
  curatedDrawable: boolean,
): MapBounds | null {
  if (!curatedDrawable) return null;
  const [[west, south], [east, north]] = cityBounds;
  return { west, south, east, north };
}
