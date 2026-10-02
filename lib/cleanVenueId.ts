// Shared venue-id cleaner. Imports nothing.

/** Cap used by community prices, venue signals, price-evidence missions and occupancy. */
export const CLEAN_VENUE_ID_MAX = 64;

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/** Strip ASCII controls, trim, and cap. A non-string is "". */
export function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, CLEAN_VENUE_ID_MAX);
}

/**
 * Trim and cap, leaving control characters in place. Occupancy stored ids
 * this way; the other writers strip.
 */
export function trimVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, CLEAN_VENUE_ID_MAX);
}
