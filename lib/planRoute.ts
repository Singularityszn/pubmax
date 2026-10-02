import { CITIES, pointInCityBounds, type CityId } from "@/lib/cities";
import { isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, OPEN_PLAN_PLACE_PREFIX } from "@/lib/openSocialCrew";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import type { PlanStopDTO } from "@/lib/plan";
import { isPlanStopCount, MAX_PLAN_STOP_COUNT } from "@/lib/planStopCount";

export type PlanStopTarget = { venueId: string; venueName: string; alternatives?: PlanStopDTO["alternatives"] };

/**
 * The ONE answer to "may a Plan hold this Stop id, and what is it called".
 * Listed venues and submitted UK base pub identities resolve against their own
 * server packs, alongside a `place:<poi id>` meeting point from the ambient POI
 * layer. Free text resolves to nothing, so it can never be stored.
 *
 * Creation is city-scoped and route replacement is not (a Plan persists no
 * city), so the caller says which cities may answer; the rule itself is the
 * same either way.
 */
export async function planStopResolver(
  cityId?: CityId,
  submitted: readonly unknown[] = [],
): Promise<(raw: unknown) => PlanStopTarget | null> {
  return (await planStopResolution(cityId, submitted)).resolve;
}

async function planStopResolution(cityId?: CityId, submitted: readonly unknown[] = []) {
  const cities = cityId ? [cityId] : (Object.keys(CITIES) as CityId[]);
  const venueLists = await Promise.all(cities.map((city) => loadConciergeVenues(city)));
  const venuesById = new Map<string, PlanStopTarget>(venueLists.flat().map((venue) =>
    [venue.id, { venueId: venue.id, venueName: venue.name }]));
  const physicalVenueIds = new Map<string, string>();
  const submittedTargets = submitted.length <= MAX_PLAN_STOP_COUNT ? submitted.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [raw];
    const alternatives = (raw as Record<string, unknown>).alternatives;
    return alternatives === undefined ? [raw]
      : Array.isArray(alternatives) && alternatives.length <= 24 ? [raw, ...alternatives] : [];
  }) : [];
  const baseIds = [...new Set(submittedTargets.flatMap((raw) => {
    const id = raw && typeof raw === "object" ? (raw as Record<string, unknown>).venueId : raw;
    return typeof id === "string" && isNationalBaseVenueId(id) ? [id] : [];
  }))];
  for (const id of baseIds) {
    const lookup = await lookupUkBasePub(id);
    if (lookup.status === "ready" && lookup.pub.kind === "pub"
      && cities.some((city) => pointInCityBounds(lookup.pub.lat, lookup.pub.lng, CITIES[city]))) {
      // Alias equivalence prevents duplicates without replacing the submitted identity.
      physicalVenueIds.set(id, venuesById.has(lookup.pub.curatedVenueId)
        ? lookup.pub.curatedVenueId : lookup.pub.id);
      venuesById.set(id, { venueId: lookup.pub.id, venueName: lookup.pub.name });
    }
  }
  const placesById = new Map(
    cities.flatMap((city) =>
      cultureWaypointPois(city).map((poi) => [poi.id, poi] as const),
    ),
  );
  const resolve = (raw: unknown): PlanStopTarget | null => {
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
    return venue ?? null;
  };
  return { resolve, physicalVenueId: (id: string) => physicalVenueIds.get(id) ?? id };
}

/**
 * Rebuild a proposed route from the server-owned data. A Plan does not persist
 * a city yet, so replacement accepts only canonical ids in shipped city
 * datasets, their POI layers, or UK base pubs within those city bounds. It returns canonical
 * display names.
 */
export async function canonicalPlanRoute(raw: unknown, cityId?: CityId): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || !isPlanStopCount(raw.length)) return null;
  const { resolve, physicalVenueId } = await planStopResolution(cityId, raw);
  const stops = raw.map((value, position) => {
    const target = resolve(value);
    if (!target) return null;
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const rawAlternatives = row.alternatives;
    if (rawAlternatives !== undefined && (!Array.isArray(rawAlternatives) || rawAlternatives.length > 24)) return null;
    const alternatives = (rawAlternatives ?? []).map((alternative: unknown) => {
      const canonical = resolve(alternative);
      if (!canonical) return null;
      const price = cleanSelectedDrinkPriceEvidence(alternative && typeof alternative === "object"
        ? (alternative as Record<string, unknown>).selectedDrinkPriceEvidence : null);
      return { ...canonical, ...(price ? { selectedDrinkPriceEvidence: price } : {}) };
    });
    if (alternatives.some((alternative: PlanStopTarget | null) => alternative === null)) return null;
    const hint = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    return { ...target, position, ...(hint ? { selectedDrinkPriceEvidence: hint } : {}),
      ...(alternatives.length ? { alternatives: alternatives as NonNullable<PlanStopDTO["alternatives"]> } : {}) };
  });
  if (stops.some((stop) => stop === null)) return null;
  const resolved = stops as PlanStopDTO[];
  const routeIds = new Set(resolved.map((stop) => physicalVenueId(stop.venueId)));
  if (routeIds.size !== resolved.length) return null;
  return resolved.some((stop) => {
    const ids = stop.alternatives?.map((alternative) => physicalVenueId(alternative.venueId)) ?? [];
    return ids.some((id) => routeIds.has(id)) || new Set(ids).size !== ids.length;
  }) ? null : resolved;
}
