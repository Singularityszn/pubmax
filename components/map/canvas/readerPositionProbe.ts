import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

// For the browser suite: whether the reader dot layers exist and what the
// user-location GeoJSON source holds right now. Unconditional in production,
// like the camera and painted-pin probes beside it.
export const MAP_READER_POSITION_PROBE_KEY = "__pubmaxMapReaderPosition";

export type MapReaderPositionProbeReading = {
  hasAccuracyLayer: boolean;
  hasCoreLayer: boolean;
  coordinates: [number, number] | null;
};

type ReaderPositionProbe = {
  read: () => MapReaderPositionProbeReading;
};

type ProbeWindow = Window & {
  [MAP_READER_POSITION_PROBE_KEY]?: ReaderPositionProbe;
};

function readCoordinates(
  map: maplibregl.Map,
): [number, number] | null {
  const features = map.querySourceFeatures("user-location");
  const point = features.find(
    (feature) => feature.geometry.type === "Point",
  );
  if (!point || point.geometry.type !== "Point") return null;
  const [lng, lat] = point.geometry.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** Publishes reader-position layer and source state for the browser suite. */
export function installMapReaderPositionProbe(map: maplibregl.Map): () => void {
  const probeWindow = window as ProbeWindow;
  probeWindow[MAP_READER_POSITION_PROBE_KEY] = {
    read: () => ({
      hasAccuracyLayer: Boolean(map.getLayer("user-location-accuracy")),
      hasCoreLayer: Boolean(map.getLayer("user-location-core")),
      coordinates: readCoordinates(map),
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
  if (!map) return;
  (map.getSource("user-location") as maplibregl.GeoJSONSource | undefined)?.setData(
    data,
  );
}
