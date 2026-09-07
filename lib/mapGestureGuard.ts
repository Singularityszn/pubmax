import type { CameraIntentKind } from "@/lib/cameraIntent";

// Who owns the camera while a reader has hold of it.
//
// DEFECT (captain, phone QA, 3 Sep 2026): the map would not hold the bearing a
// reader had just set. Two separate writers took it back. The idle ambient
// orbit is gone (see PubMapCanvas): it turned the map at 0.6 degrees a second
// for as long as the reader left it alone, so a chosen view decayed on its own.
// This module answers the other half: a camera move the app decided to make,
// arriving while the reader still has the map.
//
// A gesture is not over when the fingers lift. A reader who has just panned is
// still reading, and a fit that lands a moment later throws away the view they
// were reading. So the reader keeps the camera for a short hold after the
// gesture ends.
//
// The hold is NOT applied to every intent, and the distinction is the whole
// design. A camera move that a reader ASKED for - tapping a pin, a cluster, a
// landmark, "Show all", Near me, picking an area - must land at once, because
// panning to a pin and then tapping it is the ordinary way into a venue and a
// two second dead spot there would be a worse defect than the one being fixed.
// What the hold refuses is the REACTIVE class: a fit that fires because data
// changed underneath, which nobody asked for and which is the class that
// actually arrives unprompted mid-read.
//
// While a gesture is genuinely in flight, nothing moves the camera at all. A
// tap cannot occur inside a drag, so no reader-requested move is lost to it.

/** How long after a gesture ends the reader still owns the camera. */
export const GESTURE_CAMERA_HOLD_MS = 2_000;

/**
 * Camera intents no reader asked for. `route` and `query` fire off a changed
 * venue or route array; `arrival` is the map's own opening turn
 * (lib/mapArrivalBearing.ts). All three can land in the middle of somebody
 * reading the map, and a reader who has already taken hold of the camera has
 * said what attitude they want.
 */
export const REACTIVE_CAMERA_INTENTS: readonly CameraIntentKind[] = [
  "arrival",
  "route",
  "query",
];

export type GestureCameraState = {
  /** A gesture is on the glass right now. */
  active: boolean;
  /** When the last gesture ended, or null when the reader has moved nothing. */
  endedAt: number | null;
};

export function idleGestureCameraState(): GestureCameraState {
  return { active: false, endedAt: null };
}

export function isReactiveCameraIntent(kind: CameraIntentKind): boolean {
  return REACTIVE_CAMERA_INTENTS.includes(kind);
}

/**
 * Whether this camera intent must stand down.
 *
 * `now` and `holdMs` are passed in rather than read here so the rule stays a
 * function of its inputs and the canvas keeps the one clock.
 */
export function cameraIntentBlocked(
  kind: CameraIntentKind,
  state: GestureCameraState,
  now: number,
  holdMs: number = GESTURE_CAMERA_HOLD_MS,
): boolean {
  if (state.active) return true;
  if (!isReactiveCameraIntent(kind)) return false;
  if (state.endedAt === null) return false;
  return now - state.endedAt < holdMs;
}
