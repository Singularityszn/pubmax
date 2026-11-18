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
// Stationary contact also holds the map. MapLibre can end its movement before
// the last pointer or touch is released.

/** How long reactive moves wait after the last gesture or contact ends. */
export const GESTURE_CAMERA_HOLD_MS = 2_000;

/**
 * Camera intents no reader asked for. `route` and `query` fire off a changed
 * venue or route array; `arrival` is the map's own opening turn
 * (lib/mapArrivalBearing.ts); `pal` frames a voice answer that lands seconds
 * after the ask (lib/palMapCommands.ts). All of them can land in the middle of
 * somebody reading the map, and a reader who has already taken hold of the
 * camera has said what attitude they want.
 */
export const REACTIVE_CAMERA_INTENTS: readonly CameraIntentKind[] = [
  "arrival",
  "route",
  "query",
  "pal",
];

export type GestureCameraState = {
  /** A gesture or a pointer or touch contact is active. */
  active: boolean;
  /** When the last gesture or contact ended, or null before an interaction. */
  endedAt: number | null;
  movementSerial?: number;
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


export function installMapGestureGuard(
  container: HTMLElement,
  state: { current: GestureCameraState },
  onInteraction: () => void,
) {
  const gestures = new Set<string>();
  const pointers = new Set<number>();
  const touches = new Map<number, EventTarget>();
  const publish = () => {
    const active = gestures.size + pointers.size + touches.size > 0;
    if (active === state.current.active) return;
    state.current = { ...state.current, active, endedAt: active ? null : performance.now() };
  };
  const pointerDown = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    onInteraction();
    publish();
  };
  const pointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    publish();
  };
  const touchStart = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      const target = touch.target ?? event.target;
      if (!target) continue;
      touches.set(touch.identifier, target);
      target.addEventListener("touchend", touchEnd, { passive: true, capture: true });
      target.addEventListener("touchcancel", touchEnd, { passive: true, capture: true });
    }
    onInteraction();
    publish();
  };
  const touchEnd = (event: TouchEvent | Event) => {
    if (!("changedTouches" in event)) return;
    const targets = new Set(touches.values());
    for (const touch of Array.from(event.changedTouches)) touches.delete(touch.identifier);
    for (const target of targets) {
      if (Array.from(touches.values()).includes(target)) continue;
      target.removeEventListener("touchend", touchEnd, true);
      target.removeEventListener("touchcancel", touchEnd, true);
    }
    publish();
  };
  const clearTouches = () => {
    for (const target of new Set(touches.values())) {
      target.removeEventListener("touchend", touchEnd, true);
      target.removeEventListener("touchcancel", touchEnd, true);
    }
    touches.clear();
  };
  const blur = () => {
    gestures.clear();
    pointers.clear();
    clearTouches();
    publish();
  };
  container.addEventListener("pointerdown", pointerDown, { passive: true, capture: true });
  container.addEventListener("touchstart", touchStart, { passive: true, capture: true });
  window.addEventListener("pointerup", pointerUp, { passive: true });
  window.addEventListener("pointercancel", pointerUp, { passive: true });
  window.addEventListener("touchend", touchEnd, { passive: true });
  window.addEventListener("touchcancel", touchEnd, { passive: true });
  window.addEventListener("blur", blur);

  return {
    begin: (name: string) => (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      gestures.add(name);
      state.current = { ...state.current, movementSerial: (state.current.movementSerial ?? 0) + 1 };
      onInteraction();
      publish();
    },
    end: (name: string) => () => {
      gestures.delete(name);
      publish();
    },
    settle: () => {
      gestures.clear();
      publish();
    },
    dispose: () => {
      clearTouches();
      container.removeEventListener("pointerdown", pointerDown, true);
      container.removeEventListener("touchstart", touchStart, true);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("touchend", touchEnd);
      window.removeEventListener("touchcancel", touchEnd);
      window.removeEventListener("blur", blur);
      state.current = idleGestureCameraState();
    },
  };
}
