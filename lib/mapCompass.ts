// The one compass on the map, and what pressing it hands back.
//
// Captain decision, 3 Sep 2026: a compass RESETS the view. It used to be two
// controls answering the same question differently. MapLibre's own compass
// reset to flat north (bearing 0, pitch 0), which this map never opens on: the
// resting attitude of a city here is tilted and slightly turned, so its reset
// handed the reader a view the product does not have. Beside it the app's
// control offered the tilt, but only while the map was ALREADY at north, so it
// vanished at the exact moment somebody had turned the map and wanted it back.
//
// One control now, with one home. It points at north, so it reads as a compass,
// and pressing it eases the camera to the city's designed attitude - bearing
// AND pitch together, because a reset that dropped the tilt would be a
// different view rather than the one the map opens on.
//
// Captain, 7 Sep 2026: that home is the Layers popover, not the map edge. A
// reader met eighteen controls at 1440 before touching a pin, and this was one
// of two worded chips parked beside the zoom (walk finding B9). The rule above
// is unchanged: what it refuses is a compass that appears and vanishes with the
// map's own attitude, and a control behind one button the reader presses is not
// that.

export type CompassAttitude = { bearing: number; pitch: number };

/** Below this, a bearing or a pitch is the designed one rather than a nudge off it. */
export const COMPASS_SETTLED_EPSILON = 0.5;

/** The attitude the city opens on. Absent axes rest at zero. */
export function compassResetTarget(
  designed: { pitch?: number; bearing?: number },
): CompassAttitude {
  return { bearing: designed.bearing ?? 0, pitch: designed.pitch ?? 0 };
}

/**
 * Whether the camera has been moved off the city's designed attitude.
 *
 * The control renders either way, because a compass that comes and goes is not
 * a compass. This answers whether pressing it would change anything, which is
 * what the accessible name has to be honest about.
 */
export function mapIsOffHouseAttitude(
  bearing: number,
  pitch: number,
  designed: { pitch?: number; bearing?: number },
): boolean {
  const target = compassResetTarget(designed);
  return (
    Math.abs(bearing - target.bearing) > COMPASS_SETTLED_EPSILON ||
    Math.abs(pitch - target.pitch) > COMPASS_SETTLED_EPSILON
  );
}

/**
 * Whether the camera reset has a live camera to act on. A failed canvas
 * (`mapError`) renders the fallback card, so the reset is withheld there even
 * when the last known attitude was off the city's own.
 */
export function cameraResetAvailable(offAttitude: boolean, canvasFailed: boolean): boolean {
  return offAttitude && !canvasFailed;
}

/** How long the reset takes. Long enough to follow, short enough to be an answer. */
export const COMPASS_RESET_DURATION_MS = 450;

/** The one sentence this control says about itself. */
export function compassResetLabel(cityDisplayName: string): string {
  return `Reset the map view of ${cityDisplayName}`;
}
