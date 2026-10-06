import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import { lngLatOf } from "@/lib/geo";

// For the browser suite: whether the reader dot layers exist and what the
// user-location GeoJSON source holds right now. Unconditional in production,
// like the camera and painted-pin probes beside it.
const MAP_READER_POSITION_PROBE_KEY = "__pubmaxMapReaderPosition";

type MapReaderPositionProbeReading = {
  hasSource: boolean;
  hasAccuracyLayer: boolean;
  hasCoreLayer: boolean;
  /**
   * What the canvas last handed the source. Exact, and there whether or not
   * the fix is on screen.
   */
  written: [number, number] | null;
  /**
   * What MapLibre is actually rendering. Read back out of a decoded tile, so
   * it is quantised to the tile grid and it is null while the fix sits outside
   * the tiles the viewport has loaded.
   */
  rendered: [number, number] | null;
};

type ReaderPositionProbe = {
  read: () => MapReaderPositionProbeReading;
};

type ProbeWindow = Window & {
  [MAP_READER_POSITION_PROBE_KEY]?: ReaderPositionProbe;
};

// The last collection handed to the source. The probe needs the figure the
// canvas wrote, not only the one a tile decodes back, so that a spec can tell
// "the watch stopped feeding the map" apart from "the dot scrolled off screen".
let lastSynced: FeatureCollection<Point> | null = null;

function firstPoint(
  collection: FeatureCollection<Point> | null,
): [number, number] | null {
  const feature = collection?.features.find(
    (candidate) => candidate.geometry.type === "Point",
  );
  if (!feature) return null;
  const lngLat = lngLatOf(feature.geometry.coordinates);
  if (!lngLat || !lngLat.every(Number.isFinite)) return null;
  return lngLat;
}

function renderedCoordinates(
  map: maplibregl.Map,
): [number, number] | null {
  const features = map.querySourceFeatures("user-location");
  const point = features.find((feature) => feature.geometry.type === "Point");
  if (!point || point.geometry.type !== "Point") return null;
  const lngLat = lngLatOf(point.geometry.coordinates);
  if (!lngLat || !lngLat.every(Number.isFinite)) return null;
  return lngLat;
}

/** Publishes reader-position layer and source state for the browser suite. */
export function installMapReaderPositionProbe(map: maplibregl.Map): () => void {
  const probeWindow = window as ProbeWindow;
  probeWindow[MAP_READER_POSITION_PROBE_KEY] = {
    read: () => ({
      hasSource: Boolean(map.getSource("user-location")),
      hasAccuracyLayer: Boolean(map.getLayer("user-location-accuracy")),
      hasCoreLayer: Boolean(map.getLayer("user-location-core")),
      written: firstPoint(lastSynced),
      rendered: renderedCoordinates(map),
    }),
  };
  return () => {
    delete probeWindow[MAP_READER_POSITION_PROBE_KEY];
  };
}

/** Updates the user-location source only; never moves the camera. */
export function syncReaderPositionOnMap(
  map: maplibregl.Map | null | undefined,
  data: FeatureCollection<Point>,
): void {
  lastSynced = data;
  if (!map) return;
  (map.getSource("user-location") as maplibregl.GeoJSONSource | undefined)?.setData(
    data,
  );
}
