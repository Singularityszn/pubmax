import { CITIES, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, OPEN_PLAN_PLACE_PREFIX } from "@/lib/openSocialCrew";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import type { PlanStopDTO } from "@/lib/plan";
import { isPlanStopCount } from "@/lib/planStopCount";

export type PlanStopTarget = { venueId: string; venueName: string };

/**
 * The ONE answer to "may a Plan hold this Stop id, and what is it called".
 * Two id shapes resolve, both against server-owned data: a listed venue from
 * the Venue Dataset, and a `place:<poi id>` meeting point from the ambient POI
 * layer. Free text resolves to nothing, so it can never be stored.
 *
 * Creation is city-scoped and route replacement is not (a Plan persists no
 * city), so the caller says which cities may answer; the rule itself is the
 * same either way.
 */
export async function planStopResolver(
  cityId?: CityId,
): Promise<(raw: unknown) => PlanStopTarget | null> {
  const cities = cityId ? [cityId] : (Object.keys(CITIES) as CityId[]);
  const venueLists = await Promise.all(cities.map((city) => loadConciergeVenues(city)));
  const venuesById = new Map(venueLists.flat().map((venue) => [venue.id, venue]));
  const placesById = new Map(
    cities.flatMap((city) =>
      cultureWaypointPois(city).map((poi) => [poi.id, poi] as const),
    ),
  );
  return (raw: unknown): PlanStopTarget | null => {
    const value = raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).venueId
      : raw;
    if (typeof value !== "string") return null;
    const classified = classifyOpenMeetingPoint(value);
    if (classified.kind === "refused") return null;
    if (classified.kind === "place") {
      const poi = placesById.get(classified.placeId);
      return poi
        ? { venueId: `${OPEN_PLAN_PLACE_PREFIX}${poi.id}`, venueName: poi.name }
        : null;
    }
    const venue = venuesById.get(classified.venueId);
    return venue ? { venueId: venue.id, venueName: venue.name } : null;
  };
}

/**
 * Rebuild a proposed route from the server-owned data. A Plan does not persist
 * a city yet, so replacement accepts only ids that occur in a shipped city
 * dataset (or that city's POI layer) and always returns their canonical
 * display names.
 */
export async function canonicalPlanRoute(raw: unknown): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || !isPlanStopCount(raw.length)) return null;
  const resolve = await planStopResolver();
  const stops = raw.map((value, position) => {
    const target = resolve(value);
    if (!target) return null;
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const evidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    const rawAlternatives = row.alternatives ?? [];
    if (!Array.isArray(rawAlternatives) || rawAlternatives.length > 24) return null;
    const alternatives = rawAlternatives.map((raw) => {
      const backup = resolve(raw);
      if (!backup) return null;
      const price = cleanSelectedDrinkPriceEvidence(raw?.selectedDrinkPriceEvidence);
      return { ...backup, ...(price ? { selectedDrinkPriceEvidence: price } : {}) };
    });
    if (alternatives.some((backup) => !backup)) return null;
    return { ...target, position, ...(evidence ? { selectedDrinkPriceEvidence: evidence } : {}),
      ...(alternatives.length ? { alternatives: alternatives as NonNullable<PlanStopDTO["alternatives"]> } : {}) };
  });
  if (stops.some((stop) => stop === null)) return null;
  const resolved = stops as PlanStopDTO[];
  const ids = resolved.map((stop) => stop.venueId);
  if (new Set(ids).size !== ids.length) return null;
  if (resolved.some((stop) => {
    const backups = stop.alternatives?.map((backup) => backup.venueId) ?? [];
    return new Set(backups).size !== backups.length || backups.some((id) => ids.includes(id));
  })) return null;
  return resolved;
}
