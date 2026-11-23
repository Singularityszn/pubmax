import "server-only";

import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { DAY_MS } from "@/lib/dayMs";
import { nightAreasByCity, type NightArea } from "@/lib/nightAreas";
import { planAreaContains, type PlanAreaTimeFits } from "@/lib/planAreaHours";
import { planRouteWindowEndIso } from "@/lib/planGenerationIntake";
import { PLAN_TIME_WINDOWS, nextLondonOccurrenceIso } from "@/lib/planIntake";
import { hasCurrentAttributableOpeningSchedule, type PlanOpeningSchedule } from "@/lib/planRouteEvidence";
import { planOpeningSchedulesForVenues } from "@/lib/planRouteEvidence.server";
import { selectGroundedPlanRoute, type GroundedPlanRouteCandidate } from "@/lib/planRouteOptimizer";
import { MAX_PLAN_STOP_COUNT } from "@/lib/planStopCount";
import { pubStreetWalkKm } from "@/lib/pubWalkPairs.server";

type Venue = { id: string; name: string; lat: number; lng: number; promoted?: boolean };

/** A time is offered when some day in the coming week can give the route. */
const DAYS_AHEAD = 7;

/**
 * For each area, the most stops the generator's own route search finds at each
 * time window, from the pubs with current listed hours and no other need. A
 * reader's budget or access need can only lower it.
 */
export function planAreaTimeFits(
  areas: readonly Pick<NightArea, "slug" | "centre" | "radiusKm">[],
  venues: readonly Venue[],
  schedules: ReadonlyMap<string, PlanOpeningSchedule | null>,
  now: number,
  streetWalkKm?: (fromVenueId: string, toVenueId: string) => number | null,
): PlanAreaTimeFits {
  const fits: PlanAreaTimeFits = {};
  for (const area of areas) {
    const candidates: GroundedPlanRouteCandidate<string>[] = venues.flatMap((venue) => {
      const openingSchedule = schedules.get(venue.id) ?? null;
      return planAreaContains(area, venue) && hasCurrentAttributableOpeningSchedule(openingSchedule, now)
        ? [{
            value: venue.id, venueId: venue.id, venueName: venue.name, score: 0, lat: venue.lat, lng: venue.lng,
            price: { pence: null, source: null, confidenceState: "unknown" }, promoted: venue.promoted === true,
            avoidedByReviewedSignal: false, access: {}, openingSchedule,
          }]
        : [];
    });
    const areaFits: Partial<Record<(typeof PLAN_TIME_WINDOWS)[number]["id"], number>> = {};
    for (const window of PLAN_TIME_WINDOWS) {
      let most = 0;
      for (let day = 0; day < DAYS_AHEAD; day += 1) {
        const startsAt = nextLondonOccurrenceIso(window.id, new Date(now + day * DAY_MS));
        const endsAt = planRouteWindowEndIso(window.end, startsAt);
        if (!endsAt) continue;
        // A route that fits holds a shorter one that fits, so count up from the best so far.
        while (most < Math.min(candidates.length, MAX_PLAN_STOP_COUNT) && selectGroundedPlanRoute(candidates, {
          exactArea: null, accessibilityNeeds: [], budgetLimitPence: null, budgetTier: null, groupSize: null,
          transportConstraints: [], routeWindow: { startsAt, endsAt }, now, stopCount: most + 1, streetWalkKm,
        }).ok) most += 1;
      }
      if (most > 0) areaFits[window.id] = most;
    }
    if (Object.keys(areaFits).length > 0) fits[area.slug] = areaFits;
  }
  return fits;
}

/** Read with the /plan page from the venues and listed hours the generator joins. Never throws. */
export async function loadPlanAreaTimeFits(now = Date.now()): Promise<PlanAreaTimeFits | null> {
  try {
    const fits: PlanAreaTimeFits = {};
    for (const { cityId, areas } of nightAreasByCity()) {
      const venues = (await loadConciergeVenues(cityId))
        .filter((venue) => areas.some((area) => planAreaContains(area, venue)));
      Object.assign(fits, planAreaTimeFits(areas, venues, await planOpeningSchedulesForVenues(venues), now, pubStreetWalkKm));
    }
    return fits;
  } catch {
    return null;
  }
}
