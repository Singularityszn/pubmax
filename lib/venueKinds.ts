/**
 * Every kind of place the venue layers can hold. ONE list, because a second
 * copy of it is a gate that silently drops a row: `buildVenueIndexFromSlim`,
 * `isValidSlimVenue` and the zone index each restated it, so a kind added in
 * one place would have been discarded by the next reader with nothing failing.
 *
 * The first five are the CURATED kinds, which carry prices, pint lanes and
 * every pub surface. The rest arrived with the UK-wide OSM venue pack
 * (`scripts/fetch_uk_osm_venues.mjs`) and are PRESENT-BUT-NEUTRAL: `isPubVenueKind`
 * is false for them, so no price is assumed, no pint lane opens, and no pub
 * surface claims them. Building anything for them is a separate wave.
 */
export const VENUE_KINDS = [
  "pub",
  "bar",
  "club",
  "food",
  "restaurant",
  "cafe",
  "coworking",
  "library",
  "hotel_lounge",
  "other",
] as const;

export type VenueKind = (typeof VENUE_KINDS)[number];

export function isVenueKind(value: unknown): value is VenueKind {
  return typeof value === "string" && (VENUE_KINDS as readonly string[]).includes(value);
}
