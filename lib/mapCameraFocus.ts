import { nextCameraRequestToken, type CameraIntentKind } from "@/lib/cameraIntent";

// Opening-location tokens do not use the user request sequence. Keep the
// source in the focus key so an opening result cannot consume an area pick.

/** Who asked for the camera. A closed set: every owner names itself. */
type MapCameraFocusSource = "opening-location" | "area";

export type MapCameraFocus = {
  center: [number, number];
  zoom: number;
  source: MapCameraFocusSource;
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
 * Whether the opening-location answer has had its say over the camera.
 *
 * True when there was no question to ask, when the reader cancelled it or took
 * the map first, or once the answer has minted its focus. Until then the
 * canvas holds the opening turn back (lib/mapArrivalBearing.ts).
 */
export function openingCameraSettled(opening: {
  resolving: boolean;
  cancelled: boolean;
  touched: boolean;
  focus: MapCameraFocus | null;
}): boolean {
  return !opening.resolving || opening.cancelled || opening.touched || opening.focus !== null;
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
  camera: { center: [number, number]; zoom: number },
): MapCameraFocus {
  return {
    center: camera.center,
    zoom: camera.zoom,
    source: "area",
    token: nextCameraRequestToken(),
  };
}
