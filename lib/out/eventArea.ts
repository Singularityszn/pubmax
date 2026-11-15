import { CITY_BOUNDS } from "@/lib/cityBounds.mjs";
import type { CityId } from "@/lib/cities";
import { nightAreaForPoint } from "@/lib/pricedLanding";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * Serve-time night-area slug from the row's own point. Never invents a pub.
 *
 * This reads the point directly (`nightAreaForPoint`) rather than going through
 * `assignVenueToNightArea`: that memo is keyed on a venue id, and a provider
 * event id is ephemeral, so a long-lived process would accumulate one permanent
 * entry per listing it has ever served.
 */
export function fillEventArea(row: WhatsOnRow): WhatsOnRow {
  if (row.area) return row;
  if (row.lat === undefined || row.lng === undefined) return row;
  const assigned = nightAreaForPoint(row.lng, row.lat);
  return assigned ? { ...row, area: assigned.slug } : row;
}

/** Coordinates take precedence. Only a verified city pub can replace a missing point. */
export function eventIsInCity(
  row: WhatsOnRow,
  city: CityId,
  verifiedVenueIds: ReadonlySet<string>,
): boolean {
  if (row.lat !== undefined || row.lng !== undefined) {
    const bounds = CITY_BOUNDS[city];
    return Boolean(bounds && typeof row.lat === "number" && Number.isFinite(row.lat) &&
      typeof row.lng === "number" && Number.isFinite(row.lng) &&
      row.lat >= bounds.latMin && row.lat <= bounds.latMax &&
      row.lng >= bounds.lonMin && row.lng <= bounds.lonMax);
  }
  return Boolean(row.venueId && verifiedVenueIds.has(row.venueId));
}
