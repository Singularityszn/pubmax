// The slight turn the map makes when it arrives, and the four cases where it
// makes none.
//
// Captain, 7 Sep 2026: "I also want the map to rotate slightly." A flat map
// reads as a diagram. A few degrees off north reads as a place, which is the
// attitude every city in lib/cities.ts is designed to open on.
//
// This is NOT the idle ambient orbit coming back. That writer turned the map
// for as long as the reader left it alone, so a chosen bearing decayed on its
// own (deleted 3 Sep 2026). This
// is ONE eased move, once per map, and the camera is still afterwards.
//
// A cold opening builds the canvas at bearing 0 on the city's own centre and
// zoom, whether or not the opening-location question has answered, and the
// focus move that follows carries centre and zoom only, so a cold map arrives
// at 0 and turns (captain's decision B, 24 Sep 2026). A resumed or restored
// session arrives at the attitude it was left at.
//
// So the rule reads the bearing the map ACTUALLY holds rather than assuming
// one. A flat map turns; a map that already has an attitude keeps it, because
// four degrees is not an improvement on eight and undoing a designed view to
// impose a smaller one would be the idle orbit's mistake again. Either way the
// map comes to rest off north, which is what was asked for.

/** How far off north the map settles. Four degrees reads as a place, not a tilt. */
export const MAP_ARRIVAL_BEARING_DEG = 4;

/** Long enough to read as a move, short enough that nothing is withheld. */
export const MAP_ARRIVAL_BEARING_DURATION_MS = 1_000;

/**
 * Below this, a bearing is the flat arrival rather than a rotation somebody
 * owns. A resumed session or a reader's own turn is left exactly as it is.
 */
const MAP_ARRIVAL_BEARING_EPSILON = 0.5;

// How the turn waits for the camera writers around it.
//
// The arrival lands beside two others, the resumed viewport and the
// opening-location answer. Both are the reader's own view and both must win, so
// the turn waits for the last of them rather than racing it. Measured without
// the wait, on the phone rig: the opening-location answer schedules its move a
// frame or so after the map is ready, the camera lane is latest-wins, and it
// cancelled the turn's pending frame outright. Four runs of four came to rest
// at exactly the bearing they arrived at.
//
// The canvas polls rather than waiting on MapLibre's `idle`, because `idle`
// also waits on every requested tile and a basemap that never finishes would
// mean a map that never turns. The ceiling is the same judgement: past it the
// turn happens anyway, and the gesture guard still refuses it if the reader has
// taken the map.
//
// They live here rather than in the canvas because the browser spec has to wait
// out the same window before it may read a resting bearing, and two copies of
// that window is how a spec starts reading the map before it has turned.

/** How often the canvas asks whether the camera has stopped. */
export const ARRIVAL_BEARING_POLL_MS = 100;

/** How many consecutive still polls count as a camera nobody is writing. */
export const ARRIVAL_BEARING_STILL_POLLS = 1;

/** Past this the turn happens whether the camera has settled or not. */
export const ARRIVAL_BEARING_WAIT_CEILING_MS = 6_000;

/**
 * The longest the turn can take to be over, counted from the map being ready.
 *
 * The wait runs to its ceiling, the stillness window closes, and the eased move
 * takes its second. A reader never sees this number; a browser spec waits it
 * out before it reads a resting bearing.
 */
export const MAP_ARRIVAL_BEARING_SETTLED_BY_MS =
  ARRIVAL_BEARING_WAIT_CEILING_MS +
  ARRIVAL_BEARING_STILL_POLLS * ARRIVAL_BEARING_POLL_MS +
  MAP_ARRIVAL_BEARING_DURATION_MS;

export type ArrivalBearingWait = { stillPolls: number; waitedMs: number };

/**
 * One poll of the turn's wait: the wait that follows, or null once the turn may
 * run. A camera the opening-location answer has not moved yet is not still,
 * because that answer's move is on its way and would stop the turn mid-ease.
 * The ceiling runs regardless, so a camera that never settles still turns.
 */
export function nextArrivalBearingWait(
  wait: ArrivalBearingWait,
  sample: { moving: boolean; openingPending: boolean },
): ArrivalBearingWait | null {
  const waitedMs = wait.waitedMs + ARRIVAL_BEARING_POLL_MS;
  const stillPolls = sample.moving || sample.openingPending ? 0 : wait.stillPolls + 1;
  if (stillPolls >= ARRIVAL_BEARING_STILL_POLLS) return null;
  if (waitedMs >= ARRIVAL_BEARING_WAIT_CEILING_MS) return null;
  return { stillPolls, waitedMs };
}

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
