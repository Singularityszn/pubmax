import type { ExpressionSpecification } from "maplibre-gl";

import type { Feature, FeatureCollection, Point } from "geojson";

/** Browser geolocation options for the map reader dot (option A: paint only). */
export const MAP_READER_POSITION_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 10_000,
  timeout: 15_000,
};

export type MapReaderPosition = {
  lat: number;
  lng: number;
  accuracyMeters: number;
};

export const MAP_READER_LOCATION_LATCH_EVENT = "pubmax:map-reader-location-latch";

/** Signal that the reader granted location through an existing map ask. */
export function latchMapReaderLocationWatch(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(MAP_READER_LOCATION_LATCH_EVENT));
  } catch {
    // Older environments: the permissions query on mount still covers granted.
  }
}

function validAccuracy(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 25;
  }
  return value;
}

export function mapReaderPositionFromGeolocation(
  position: GeolocationPosition,
): MapReaderPosition | null {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    return null;
  }
  return {
    lat,
    lng,
    accuracyMeters: validAccuracy(position.coords.accuracy),
  };
}

export function mapReaderPositionGeoJSON(
  position: MapReaderPosition | null,
): FeatureCollection<Point> {
  if (!position) {
    return { type: "FeatureCollection", features: [] };
  }
  const feature: Feature<Point> = {
    type: "Feature",
    properties: {
      accuracyMeters: position.accuracyMeters,
      lat: position.lat,
    },
    geometry: {
      type: "Point",
      coordinates: [position.lng, position.lat],
    },
  };
  return { type: "FeatureCollection", features: [feature] };
}

/** MapLibre circle-radius: accuracy ring diameter in pixels at the current zoom. */
export const USER_LOCATION_ACCURACY_RADIUS_PX: ExpressionSpecification = [
  "max",
  8,
  [
    "/",
    ["get", "accuracyMeters"],
    [
      "/",
      [
        "*",
        156543.03392,
        ["cos", ["*", ["get", "lat"], 0.017453292519943295]],
      ],
      ["^", 2, ["zoom"]],
    ],
  ],
];
