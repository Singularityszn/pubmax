// Sun Chaser's time window, kept apart from the sun maths so the map chip and
// its shared state can read it without loading lib/sunChaser.ts.

/** The slider moves in these steps, and the estimate samples on them. */
export const SUN_CHASER_STEP_MINUTES = 30;
/** How far ahead the slider and the estimate reach. */
export const SUN_CHASER_HORIZON_MINUTES = 6 * 60;
