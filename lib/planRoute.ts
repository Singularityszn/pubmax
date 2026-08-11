import { CITIES, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { PlanStopDTO } from "@/lib/plan";
import { isPlanStopCount } from "@/lib/planStopCount";

/**
 * Rebuild a proposed route from the server-owned Venue Dataset. A Plan does not
 * persist a city yet, so replacement accepts only ids that occur in a shipped
 * city dataset and always returns its canonical display names.
 */
export async function canonicalPlanRoute(raw: unknown): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || !isPlanStopCount(raw.length)) return null;
  const ids = raw.map((value) => value && typeof value === "object"
    ? (value as Record<string, unknown>).venueId
    : null);
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  const uniqueIds = ids as string[];
  if (new Set(uniqueIds).size !== uniqueIds.length) return null;
  const cities = Object.keys(CITIES) as CityId[];
  const venueLists = await Promise.all(cities.map((cityId) => loadConciergeVenues(cityId)));
  const byId = new Map(venueLists.flat().map((venue) => [venue.id, venue]));
  const stops = uniqueIds.map((venueId, position) => {
    const venue = byId.get(venueId);
    return venue ? { venueId: venue.id, venueName: venue.name, position } : null;
  });
  return stops.some((stop) => stop === null) ? null : stops as PlanStopDTO[];
}
