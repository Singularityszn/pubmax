// The slight turn the map makes when it arrives, and the four cases where it
// makes none.
//
// Captain, 7 Sep 2026: "I also want the map to rotate slightly." A flat map
// reads as a diagram. A few degrees off north reads as a place, which is the
// attitude every city in lib/cities.ts is designed to open on.
//
// This is NOT the idle ambient orbit coming back. That writer turned the map
// for as long as the reader left it alone, so a chosen bearing decayed on its
// own (deleted 3 Sep 2026, fenced by __tests__/idleOrbitRemoved.test.ts). This
// is ONE eased move, once per map, and the camera is still afterwards.
//
// The measured shipped arrival is bearing 0: the canvas is constructed while
// the opening-location question is still open, so it takes the hold view's flat
// attitude, and the focus move that follows carries centre and zoom only. The
// plan is written against that reading rather than against the city's designed
// bearing, so it says what the reader sees.

/** How far off north the map settles. Four degrees reads as a place, not a tilt. */
export const MAP_ARRIVAL_BEARING_DEG = 4;

/** Long enough to read as a move, short enough that nothing is withheld. */
export const MAP_ARRIVAL_BEARING_DURATION_MS = 1_000;

/**
 * Below this, a bearing is the flat arrival rather than a rotation somebody
 * owns. A resumed session or a reader's own turn is left exactly as it is.
 */
export const MAP_ARRIVAL_BEARING_EPSILON = 0.5;

export type MapArrivalBearingPlan = {
  bearing: number;
  duration: number;
};

export type MapArrivalBearingInputs = {
  /** The bearing the map holds right now. */
  currentBearing: number;
  /** The reader asks for no motion. */
  reducedMotion: boolean;
  /**
   * The URL named a pub. That reader asked for one venue, and the fly-to into
   * it owns the camera, so the arrival adds no turn of its own.
   */
  deepLinkedVenue: boolean;
};

/**
 * The one eased turn, or null when the map must stay where it is.
 *
 * Reduced motion answers null rather than an instant jump: the turn carries no
 * information, so there is nothing to hand back without the motion.
 */
export function mapArrivalBearingPlan(
  inputs: MapArrivalBearingInputs,
): MapArrivalBearingPlan | null {
  if (inputs.deepLinkedVenue) return null;
  if (inputs.reducedMotion) return null;
  if (!Number.isFinite(inputs.currentBearing)) return null;
  if (Math.abs(inputs.currentBearing) > MAP_ARRIVAL_BEARING_EPSILON) return null;
  return {
    bearing: MAP_ARRIVAL_BEARING_DEG,
    duration: MAP_ARRIVAL_BEARING_DURATION_MS,
  };
}
