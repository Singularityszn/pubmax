// How long each part of a night lasts. A PURE LEAF importing nothing, so a
// client bundle can read a window without pulling a store in behind it. The
// SQL copies live in the migrations that name each window.

/** A Plan is "on tonight" from 3 hours before the first pint. */
export const ACTIVE_PLAN_PRE_MS = 3 * 60 * 60 * 1000;
/** Until 8 hours after it (last-train o'clock). This is also the Plan's scheduled end. */
export const ACTIVE_PLAN_POST_MS = 8 * 60 * 60 * 1000;
/** Live location also stops at the first 06:00 London time after the window opens (0226). */
export const LIVE_LOCATION_CUTOFF_HOUR = 6;
/** An Open Crawl takes "Here" until 12 hours after its start. */
export const OPEN_CRAWL_ARRIVAL_CLOSE_MS = 12 * 60 * 60 * 1000;
/** A Plan beacon lasts 2 hours, and never past the Plan's end (0213). */
export const PLAN_BEACON_TTL_MS = 2 * 60 * 60 * 1000;
/** Presence lasts 2 hours, the same as the migration's `now() + interval '2 hours'`. */
export const PRESENCE_TTL_MS = 2 * 60 * 60 * 1000;
