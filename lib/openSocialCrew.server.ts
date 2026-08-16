import "server-only";

import { DEFAULT_CITY_ID, listEnabledCities, type CityId } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { classifyOpenMeetingPoint, firstPlanStop } from "@/lib/openSocialCrew";
import type { OutOpenPlan, OutOpenPlanMeetingPoint } from "@/lib/out";
import type { PlanStopDTO } from "@/lib/plan";
import { planStateResult } from "@/lib/planStore";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import type { Poi } from "@/lib/pois";

/**
 * A resolved meeting point plus the city it puts the plan in. Plans store no
 * city of their own, so the city is DERIVED here from Stop 1: a listed venue
 * through the slim index, a named public place through the ambient POI layer.
 * A meeting point that cannot be resolved names no city at all rather than
 * falling back to London.
 */
export type OpenMeetingPoint = OutOpenPlanMeetingPoint & { cityId: CityId };

export type OpenMeetingPointResolution =
  | { ok: true; meetingPoint: OpenMeetingPoint }
  | { ok: false; reason: "refused" | "unavailable" };

const placePoiIndexByCity = new Map<CityId, Map<string, Poi>>();

function placePoiIndex(cityId: CityId): Map<string, Poi> {
  let byId = placePoiIndexByCity.get(cityId);
  if (!byId) {
    byId = new Map<string, Poi>();
    for (const poi of cultureWaypointPois(cityId)) {
      byId.set(poi.id, poi);
    }
    placePoiIndexByCity.set(cityId, byId);
  }
  return byId;
}

/**
 * A read that could NOT run is `unavailable`, never `refused`: a host must not
 * be told a listed pub is not listed because a slim pack failed to load.
 */
export async function resolveOpenMeetingPoint(
  venueId: string | null | undefined,
): Promise<OpenMeetingPointResolution> {
  const classified = classifyOpenMeetingPoint(venueId);
  if (classified.kind === "refused") return { ok: false, reason: "refused" };
  if (classified.kind === "place") {
    for (const city of listEnabledCities()) {
      const poi = placePoiIndex(city.id).get(classified.placeId);
      if (!poi) continue;
      return {
        ok: true,
        meetingPoint: {
          kind: "place",
          name: poi.name,
          lng: poi.coordinates[0],
          lat: poi.coordinates[1],
          cityId: city.id,
        },
      };
    }
    return { ok: false, reason: "refused" };
  }
  const lookup = await lookupCanonicalVenue(classified.venueId);
  if (lookup.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (lookup.status === "unknown") return { ok: false, reason: "refused" };
  return {
    ok: true,
    meetingPoint: {
      kind: "venue",
      name: lookup.venue.name,
      lng: lookup.venue.lng,
      lat: lookup.venue.lat,
      cityId: cityIdFromVenueId(lookup.canonicalId) ?? DEFAULT_CITY_ID,
    },
  };
}

export async function resolveOpenMeetingFromStops(
  stops: readonly PlanStopDTO[] | null | undefined,
): Promise<OpenMeetingPointResolution> {
  return resolveOpenMeetingPoint(firstPlanStop(stops)?.venueId);
}

export async function resolveOpenPlanMeetingPoint(
  planId: string,
): Promise<OpenMeetingPointResolution> {
  const lookup = await planStateResult(planId);
  if (!lookup.ok) return { ok: false, reason: "unavailable" };
  if (!lookup.plan) return { ok: false, reason: "refused" };
  return resolveOpenMeetingFromStops(lookup.plan.stops);
}

export type OpenPlansInCity = {
  status: "ready" | "degraded";
  plans: OutOpenPlan[];
};

/**
 * Narrow listed open plans to one city and attach the meeting point the card
 * renders. A plan whose Stop 1 does not resolve is dropped rather than
 * attributed to the default city; a plan whose read could not RUN degrades the
 * answer, because a market emptied by a failed lookup may not read as a quiet
 * city.
 */
export async function openPlansInCity(
  rows: readonly OutOpenPlan[],
  cityId: CityId,
): Promise<OpenPlansInCity> {
  const plans: OutOpenPlan[] = [];
  let degraded = false;
  for (const row of rows) {
    const resolution = await resolveOpenMeetingPoint(row.stopVenueId);
    if (!resolution.ok) {
      if (resolution.reason === "unavailable") degraded = true;
      continue;
    }
    const { cityId: planCityId, ...meetingPoint } = resolution.meetingPoint;
    if (planCityId !== cityId) continue;
    plans.push({ ...row, meetingPoint });
  }
  return { status: degraded ? "degraded" : "ready", plans };
}
