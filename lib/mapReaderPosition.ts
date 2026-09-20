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

/** Degrees to radians: MapLibre's `cos` operator takes radians. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Metres per pixel at zoom 0 on the equator. MapLibre's world is
 * `tileSize * 2 ** zoom` pixels wide and its tile size is 512, so the figure is
 * the equatorial circumference over 512, which is HALF the constant a
 * 256-pixel tile scheme uses. Getting that wrong draws the ring at half size.
 */
const METRES_PER_PIXEL_AT_ZOOM_0 = 40075016.686 / 512;

const ACCURACY_RING_TOP_ZOOM = 24;

/** The fix's own accuracy radius in metres, as pixels at zoom 0 and its latitude. */
const ACCURACY_RADIUS_PX_AT_ZOOM_0: ExpressionSpecification = [
  "/",
  ["get", "accuracyMeters"],
  [
    "*",
    METRES_PER_PIXEL_AT_ZOOM_0,
    ["cos", ["*", ["get", "lat"], DEGREES_TO_RADIANS]],
  ],
];

/**
 * MapLibre `circle-radius`: the fix's accuracy radius drawn at its true size in
 * pixels, at the reader's own latitude. A ring that means metres is the only
 * honest one; a fixed halo would claim a precision the fix does not have.
 *
 * `["zoom"]` may only be the input to a TOP-LEVEL `interpolate` or `step`, so
 * the scale cannot be divided out inside the arithmetic - a style carrying it
 * anywhere else fails validation and MapLibre drops the layer in silence. An
 * `exponential` base of 2 between a zoom-0 stop and one `ACCURACY_RING_TOP_ZOOM`
 * above it, whose value is `2 ** ACCURACY_RING_TOP_ZOOM` times larger,
 * reproduces the doubling EXACTLY at every zoom between the two.
 */
export const USER_LOCATION_ACCURACY_RADIUS_PX: ExpressionSpecification = [
  "interpolate",
  ["exponential", 2],
  ["zoom"],
  0,
  ACCURACY_RADIUS_PX_AT_ZOOM_0,
  ACCURACY_RING_TOP_ZOOM,
  ["*", ACCURACY_RADIUS_PX_AT_ZOOM_0, 2 ** ACCURACY_RING_TOP_ZOOM],
];
