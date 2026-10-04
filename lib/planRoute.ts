import { CITIES, pointInCityBounds, type CityId } from "@/lib/cities";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, OPEN_PLAN_PLACE_PREFIX } from "@/lib/openSocialCrew";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import type { PlanStopDTO } from "@/lib/plan";
import { isPlanStopCount, MAX_PLAN_STOP_COUNT } from "@/lib/planStopCount";

export type PlanStopTarget = { venueId: string; venueName: string; alternatives?: PlanStopDTO["alternatives"] };

function submittedStopId(raw: unknown): string | null {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).venueId : raw;
  if (typeof value !== "string") return null;
  const classified = classifyOpenMeetingPoint(value);
  return classified.kind === "venue" ? classified.venueId
    : classified.kind === "place" ? `${OPEN_PLAN_PLACE_PREFIX}${classified.placeId}` : null;
}

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

async function planStopResolution(cityId?: CityId, submitted: readonly unknown[] = [], requireCompleteCatalogue = false) {
  const cities = cityId ? [cityId] : (Object.keys(CITIES) as CityId[]);
  const venueLists = await Promise.all(cities.map((city) => requireCompleteCatalogue
    ? loadConciergeVenues(city, { requireCompleteCatalogue: true }) : loadConciergeVenues(city)));
  const readableCities = new Set(cities.filter((_, index) => venueLists[index].length > 0));
  const venuesById = new Map<string, PlanStopTarget>(venueLists.flat().map((venue) =>
    [venue.id, { venueId: venue.id, venueName: venue.name }]));
  const physicalVenueIds = new Map<string, string>();
  const missingBaseIds = new Set<string>();
  const submittedTargets = submitted.length <= MAX_PLAN_STOP_COUNT ? submitted.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [raw];
    const alternatives = (raw as Record<string, unknown>).alternatives;
    return alternatives === undefined ? [raw]
      : Array.isArray(alternatives) && alternatives.length <= 24 ? [raw, ...alternatives] : [];
  }) : [];
  const baseIds = [...new Set(submittedTargets.flatMap((raw) => {
    const id = submittedStopId(raw);
    return id && isNationalBaseVenueId(id) ? [id] : [];
  }))];
  for (const id of baseIds) {
    const lookup = await lookupUkBasePub(id);
    if (lookup.status === "missing") missingBaseIds.add(id);
    if (lookup.status === "ready" && lookup.pub.kind === "pub"
      && cities.some((city) => pointInCityBounds(lookup.pub.lat, lookup.pub.lng, CITIES[city]))) {
      // Alias equivalence prevents duplicates without replacing the submitted identity.
      physicalVenueIds.set(id, lookup.pub.curatedVenueId || lookup.pub.id);
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
  const confirmedMissing = (id: string): boolean => {
    if (isNationalBaseVenueId(id)) return missingBaseIds.has(id);
    if (id.startsWith(OPEN_PLAN_PLACE_PREFIX)) return placesById.size > 0;
    // An empty/corrupt pack cannot prove deletion. Venue IDs identify their
    // catalogue even when the row itself has disappeared.
    return readableCities.has(cityIdFromVenueId(id) ?? "london");
  };
  return { resolve, confirmedMissing, physicalVenueId: (id: string) => physicalVenueIds.get(id) ?? id };
}

/**
 * Rebuild a proposed route from the server-owned data. A Plan does not persist
 * a city yet, so replacement accepts only canonical ids in shipped city
 * datasets, their POI layers, or UK base pubs within those city bounds. It returns canonical
 * display names.
 * Only an authorized saved-route replacement supplies persisted Stops. Other
 * callers retain strict resolution for every submitted backup.
 */
export async function canonicalPlanRoute(
  raw: unknown,
  cityId?: CityId,
  persistedStops: readonly PlanStopDTO[] = [],
): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || !isPlanStopCount(raw.length)) return null;
  const submittedIds = raw.map(submittedStopId);
  if (submittedIds.some((id) => id === null) || new Set(submittedIds).size !== raw.length) return null;
  // Validate original input before omitting any missing saved option.
  for (const value of raw) {
    const alternatives = value && typeof value === "object" ? value.alternatives : undefined;
    if (alternatives === undefined) continue;
    if (!Array.isArray(alternatives) || alternatives.length > 24) return null;
    const ids = alternatives.map(submittedStopId);
    if (ids.some((id) => id === null || submittedIds.includes(id)) || new Set(ids).size !== ids.length) return null;
  }
  const savedGroups = new Map(persistedStops.map((stop) => [stop.venueId,
    new Set([stop.venueId, ...stop.alternatives?.map((alternative) => alternative.venueId) ?? []])]));
  const { resolve, confirmedMissing, physicalVenueId } = await planStopResolution(cityId, raw, persistedStops.length > 0);
  const physicalRouteIds = new Set(submittedIds.map((id) => id && physicalVenueId(id)));
  if (physicalRouteIds.size !== raw.length) return null;
  for (const value of raw) {
    const ids = (value && typeof value === "object" ? value.alternatives ?? [] : [])
      .map((alternative: unknown) => { const id = submittedStopId(alternative); return id && physicalVenueId(id); });
    if (ids.some((id: string | null) => physicalRouteIds.has(id)) || new Set(ids).size !== ids.length) return null;
  }
  const stops = raw.map((value, position) => {
    const target = resolve(value);
    if (!target) return null;
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const rawAlternatives = row.alternatives;
    if (rawAlternatives !== undefined && (!Array.isArray(rawAlternatives) || rawAlternatives.length > 24)) return null;
    const savedParents = [value, ...rawAlternatives ?? []].map(submittedStopId)
      .filter((id): id is string => id !== null && savedGroups.has(id));
    const savedGroup = savedParents.length === 1 ? savedGroups.get(savedParents[0]) : undefined;
    const alternatives: NonNullable<PlanStopDTO["alternatives"]> = [];
    for (const alternative of rawAlternatives ?? []) {
      const canonical = resolve(alternative);
      if (!canonical) {
        const id = submittedStopId(alternative);
        if (id && savedGroup?.has(id) && confirmedMissing(id)) continue;
        return null;
      }
      const price = cleanSelectedDrinkPriceEvidence(alternative && typeof alternative === "object"
        ? (alternative as Record<string, unknown>).selectedDrinkPriceEvidence : null);
      alternatives.push({ ...canonical, ...(price ? { selectedDrinkPriceEvidence: price } : {}) });
    }
    const hint = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    return { ...target, position, ...(hint ? { selectedDrinkPriceEvidence: hint } : {}),
      ...(alternatives.length ? { alternatives } : {}) };
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
