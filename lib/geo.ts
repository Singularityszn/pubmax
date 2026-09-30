// Small shared geo helpers used across client and server egress boundaries.

export type LatLngPoint = { lat: number; lng: number };

const VIEWER_COORDINATE_FACTOR = 1_000;

/**
 * Reduce a viewer point to three decimals before network egress.
 *
 * Three decimals is roughly a 70 to 110 metre cell in the UK. That still
 * answers nearest-pub and nearest-station questions without transmitting the
 * browser's building-level GPS fix. Browser request builders and server
 * third-party forwarders both use this seam, so direct API callers cannot
 * bypass the same reduction downstream.
 */
export function coarsenViewerPoint(point: LatLngPoint): LatLngPoint {
  return {
    lat: Math.round(point.lat * VIEWER_COORDINATE_FACTOR) / VIEWER_COORDINATE_FACTOR,
    lng: Math.round(point.lng * VIEWER_COORDINATE_FACTOR) / VIEWER_COORDINATE_FACTOR,
  };
}

/** Add the rounding displacement to the browser's reported accuracy radius. */
export function coarsenedViewerAccuracy(point: LatLngPoint, reduced: LatLngPoint, accuracy: number): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (reduced.lat - point.lat) * radians;
  const longitudeDelta = (reduced.lng - point.lng) * radians;
  const arc = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(point.lat * radians) * Math.cos(reduced.lat * radians) * Math.sin(longitudeDelta / 2) ** 2;
  const displacement = 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
  return Math.max(110, Math.ceil(accuracy + displacement));
}
