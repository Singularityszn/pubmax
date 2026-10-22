// First-visit map arrival eligibility and URL suppression. The shared store
// owns dismissal and visibility, also re-exported here for existing callers.

import {
  PLAN_DESCRIBE_PARAM,
  PLAN_OCCASION_PARAM,
  PLAN_QUERY_PARAM,
} from "@/lib/planOccasion";
import { searchHasExplicitMapIntent } from "@/lib/explicitMapIntent";
import { hasDismissedMapFirstVisitArrival } from "@/lib/mapFirstVisitArrivalStore";

export {
  MAP_FIRST_VISIT_ARRIVAL_KEY,
  dismissMapFirstVisitArrival,
  dismissMapFirstVisitArrivalOnMapUse,
  hasDismissedMapFirstVisitArrival,
  mapFirstVisitArrivalBlocksConsent,
  setMapFirstVisitArrivalCardVisible,
  subscribeMapFirstVisitArrival,
} from "@/lib/mapFirstVisitArrivalStore";

/** Planner handoff params must not meet a first-visit card over the map. */
export function searchHasPlanHandoffParams(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return (
    params.has(PLAN_QUERY_PARAM) ||
    params.has(PLAN_OCCASION_PARAM) ||
    params.has(PLAN_DESCRIBE_PARAM)
  );
}

export function searchSuppressesMapFirstVisitArrival(search: string): boolean {
  return (
    searchHasExplicitMapIntent(search) || searchHasPlanHandoffParams(search)
  );
}

export function shouldShowMapFirstVisitArrival(params: {
  pinsRevealed: boolean;
  search: string;
  /**
   * A recovery toast (basemap, pub list, pin paint) is on the surface. The map
   * keeps search plus ONE toast, and this card is 256px of opaque panel over
   * the toast's own band, so a failure the reader can act on wins outright.
   * The card is not dismissed by this, only withheld: it returns when the
   * toast clears and the visit is still a first one.
   */
  recoveryToastActive?: boolean;
  storage?: Storage | null;
}): boolean {
  if (!params.pinsRevealed) return false;
  if (params.recoveryToastActive) return false;
  if (hasDismissedMapFirstVisitArrival(params.storage)) return false;
  if (searchSuppressesMapFirstVisitArrival(params.search)) return false;
  return true;
}
