// Compass button behaviour for the pub map (owner ask: "ensure the map
// rotates"). Rotation gestures were never disabled (two-finger twist on touch,
// right-drag or ctrl-drag on desktop), and every programmatic camera move
// preserves bearing since #367 — but the compass only rendered while the map
// was rotated, so at north there was no affordance to rotate or re-tilt and
// the whole capability was undiscoverable. The compass is now always visible
// and acts as a toggle; this pure helper decides what a press does so the
// decision is hermetically testable.

export type CompassAction =
  | { kind: "reset-north" }
  | { kind: "adopt-attitude"; bearing: number; pitch: number }
  | { kind: "none" };

// Below this the map reads as "pointing north" (matches the old render gate).
export const COMPASS_ROTATED_EPSILON = 0.5;

/**
 * Rotated map: settle back to north (bearing only, pitch untouched).
 * At north: ease to the city's designed attitude (e.g. London pitch 38,
 * bearing -8) so one tap makes the map dimensional again and shows, on every
 * device, that the map rotates. A city with no designed attitude has nothing
 * to adopt, so the button does nothing at north ("none" hides it).
 */
export function resolveCompassAction(
  currentBearing: number,
  designed: { pitch?: number; bearing?: number },
): CompassAction {
  if (Math.abs(currentBearing) > COMPASS_ROTATED_EPSILON) return { kind: "reset-north" };
  const bearing = designed.bearing ?? 0;
  const pitch = designed.pitch ?? 0;
  if (bearing === 0 && pitch === 0) return { kind: "none" };
  return { kind: "adopt-attitude", bearing, pitch };
}
