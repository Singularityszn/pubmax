import type * as maplibregl from "maplibre-gl";

// What a browser test needs to say about a gesture, and cannot ask the canvas
// for. A two-finger rotate is proved by the bearing it left behind, and the
// defect it is proving the absence of - a camera that keeps moving once the
// fingers are off the glass - is a bearing that changes with nobody touching
// it. Neither is readable from the DOM: the compass needle is one control's
// styling, so a spec reading it would fail the day that control changes.
//
// Unconditional, like the painted-pin probe beside it, for the same reason:
// the browser suite runs a production build, so a development-only hook would
// not exist where the test needs it. It reads the live map and stores nothing.
const MAP_CAMERA_PROBE_KEY = "__pubmaxMapCamera";

/** The camera as the map holds it right now. */
type MapCameraReading = {
  bearing: number;
  pitch: number;
  zoom: number;
  center: [number, number];
  /** True while MapLibre is running a gesture or an animation. */
  moving: boolean;
  /**
   * True while the app still owes the camera a move of its own: the opening
   * turn has not been decided yet, a scheduled move is waiting for its frame
   * or for the bottom sheet, the opening-location answer has not moved the
   * camera yet, or a granted location has not been framed yet. `moving` can
   * be false while `settling` is true. Camera rest requires both to be false
   * (lib/mapArrivalBearing.ts).
   */
  settling: boolean;
};

/**
 * Where the map is drawing one geographic point right now, in the same
 * viewport coordinates {@link import("./paintedPinProbe").PaintedMapTapPoint}
 * uses, so a spec can hold a pin's painted position against the projection the
 * camera implies.
 */
type MapProjectedPoint = { x: number; y: number };

type CameraProbe = {
  read: () => MapCameraReading;
  project: (lngLat: [number, number]) => MapProjectedPoint;
};

type CameraProbeWindow = Window & {
  [MAP_CAMERA_PROBE_KEY]?: CameraProbe;
};

function readMapCamera(
  map: maplibregl.Map,
  settling: () => boolean,
): MapCameraReading {
  const center = map.getCenter();
  return {
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    zoom: map.getZoom(),
    center: [center.lng, center.lat],
    moving: map.isMoving(),
    settling: settling(),
  };
}

function projectOnMap(
  map: maplibregl.Map,
  lngLat: [number, number],
): MapProjectedPoint {
  const rect = map.getContainer().getBoundingClientRect();
  const point = map.project(lngLat);
  return { x: rect.left + point.x, y: rect.top + point.y };
}

/** The moves the app may still owe the camera, as the canvas reads them. */
type MapCameraOwedMoves = {
  arrivalTurnSpent: boolean;
  cameraLanePending: boolean;
  openingCameraSettled: boolean;
  focusMoves: boolean;
  nearMePending: boolean;
  nearbyFramingOwed: boolean;
};

/**
 * The probe's `settling`: a move is still owed while the opening turn is
 * undecided, while a scheduled move waits for its frame, while the
 * opening-location answer has yet to move the camera (the same reading the
 * turn's own wait takes), or while a Near me answer or its framing is owed.
 */
export function mapCameraSettling(owed: MapCameraOwedMoves): boolean {
  return (
    !owed.arrivalTurnSpent ||
    owed.cameraLanePending ||
    !owed.openingCameraSettled ||
    owed.focusMoves ||
    owed.nearMePending ||
    owed.nearbyFramingOwed
  );
}

/**
 * Publishes the camera reading for the browser suite. Returns its own removal.
 * `settling` answers whether the app still owes the camera a move.
 */
export function installMapCameraProbe(
  map: maplibregl.Map,
  settling: () => boolean,
): () => void {
  const probeWindow = window as CameraProbeWindow;
  probeWindow[MAP_CAMERA_PROBE_KEY] = {
    read: () => readMapCamera(map, settling),
    project: (lngLat) => projectOnMap(map, lngLat),
  };
  return () => {
    delete probeWindow[MAP_CAMERA_PROBE_KEY];
  };
}
