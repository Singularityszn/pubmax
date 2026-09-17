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

function readMapCamera(map: maplibregl.Map): MapCameraReading {
  const center = map.getCenter();
  return {
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    zoom: map.getZoom(),
    center: [center.lng, center.lat],
    moving: map.isMoving(),
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

/** Publishes the camera reading for the browser suite. Returns its own removal. */
export function installMapCameraProbe(map: maplibregl.Map): () => void {
  const probeWindow = window as CameraProbeWindow;
  probeWindow[MAP_CAMERA_PROBE_KEY] = {
    read: () => readMapCamera(map),
    project: (lngLat) => projectOnMap(map, lngLat),
  };
  return () => {
    delete probeWindow[MAP_CAMERA_PROBE_KEY];
  };
}
