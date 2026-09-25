import type { CameraIntentKind } from "@/lib/cameraIntent";

// One deliberate camera move, and how the canvas tells it from the last one.
//
// DEFECT (captain, live, 2026-09-01): the map header read "Piccadilly & Soho"
// while the viewport sat over rural Cumbria. Picking an area updated the chip
// and left the camera where it was.
//
// Two owners feed the canvas ONE focus prop - the opening-location answer and
// every deliberate move (the choose-area pick, the Area sheet's "go somewhere
// else", a map-search area or place select) - and each kept its OWN counter
// starting at 1, while the canvas held ONE "last applied" number. So a reader
// whose opening location had already flown at token 1 picked an area, that
// pick arrived as token 1 as well, and the canvas read it as the move it had
// already made. Nothing moved, and nothing said so.
//
// A token is an IDENTITY, not a sequence, so it carries the owner that issued
// it. Two owners can then never mint the same one, and neither has to know the
// other exists.

/** Who asked for the camera. A closed set: every owner names itself. */
type MapCameraFocusSource = "opening-location" | "area";

export type MapCameraFocus = {
  center: [number, number];
  zoom: number;
  source: MapCameraFocusSource;
  /** Per-source counter. Only ever compared through `mapCameraFocusKey`. */
  token: number;
};

/** The identity the canvas remembers. Never a bare number. */
export function mapCameraFocusKey(focus: MapCameraFocus): string {
  return `${focus.source}:${focus.token}`;
}

/**
 * Whether this focus is a move the canvas has not made yet.
 *
 * `appliedKey` is the key of the last focus the canvas flew to, or null when it
 * has flown to none.
 */
export function mapCameraFocusMoves(
  focus: MapCameraFocus | null | undefined,
  appliedKey: string | null,
): boolean {
  if (!focus) return false;
  return mapCameraFocusKey(focus) !== appliedKey;
}

/**
 * The camera intent an owner's move rides on.
 *
 * The kind names the OWNER, not one shared lane. Both owners are deliberate
 * moves and fly identically, so it is tempting to give them one kind. Two
 * things forbid it. The kind is counted: a reader who searches an area counts
 * exactly ONE area intent (`e2e/map-gl.spec.ts`), and an opening-location fly
 * that lands first would inflate that count. The kind is also the PREFIX of
 * the dedupe key `components/map/canvas/useMapCamera.ts` builds, so one shared
 * kind let an opening-location fly to a view swallow an area pick to the same
 * view inside the coordinator's dedupe window.
 *
 * A total map rather than a ternary, so a third owner cannot be added to
 * `MapCameraFocusSource` without naming the lane it rides on.
 */
const CAMERA_INTENT_BY_FOCUS_SOURCE: Record<MapCameraFocusSource, CameraIntentKind> = {
  "opening-location": "opening-location",
  area: "area",
};

/**
 * Whether an opening-location answer names the view the camera already holds.
 *
 * A cold map opens on the city's own view while that question is open, so an
 * answer of "no location" usually names the same view. Flying there moves
 * nothing and stops whatever the camera is doing, the opening turn included
 * (lib/mapArrivalBearing.ts). An area pick always flies: the reader asked.
 */
export function openingFocusAlreadyFramed(
  focus: MapCameraFocus,
  camera: { center: [number, number]; zoom: number },
): boolean {
  if (focus.source !== "opening-location") return false;
  return (
    Math.abs(focus.center[0] - camera.center[0]) < 1e-6 &&
    Math.abs(focus.center[1] - camera.center[1]) < 1e-6 &&
    Math.abs(focus.zoom - camera.zoom) < 1e-6
  );
}

export function cameraIntentForFocusSource(
  source: MapCameraFocusSource,
): CameraIntentKind {
  return CAMERA_INTENT_BY_FOCUS_SOURCE[source];
}

/**
 * The next deliberate area move. Every pick mints a new identity, even for the
 * place the last pick named: the reader may have panned away since.
 */
export function nextAreaCameraFocus(
  prev: MapCameraFocus | null,
  camera: { center: [number, number]; zoom: number },
): MapCameraFocus {
  return {
    center: camera.center,
    zoom: camera.zoom,
    source: "area",
    token: (prev?.token ?? 0) + 1,
  };
}
