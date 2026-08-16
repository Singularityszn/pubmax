import "server-only";

import { DEFAULT_CITY_ID } from "@/lib/cities";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import {
  classifyOpenMeetingPoint,
  firstPlanStop,
  type OpenPlanPlaceKind,
} from "@/lib/openSocialCrew";
import type { PlanStopDTO } from "@/lib/plan";
import { planStateResult } from "@/lib/planStore";
import { resolveVenue } from "@/lib/venueIndex";

export type OpenMeetingPointResolution =
  | { ok: true; kind: OpenPlanPlaceKind }
  | { ok: false; reason: "refused" | "unavailable" };

export async function resolveOpenMeetingFromStops(
  stops: readonly PlanStopDTO[] | null | undefined,
): Promise<OpenMeetingPointResolution> {
  const classified = classifyOpenMeetingPoint(firstPlanStop(stops)?.venueId);
  if (classified.kind === "refused") return { ok: false, reason: "refused" };
  if (classified.kind === "place") {
    const found = cultureWaypointPois(DEFAULT_CITY_ID).some(
      (poi) => poi.id === classified.placeId,
    );
    return found ? { ok: true, kind: "place" } : { ok: false, reason: "refused" };
  }
  const venue = await resolveVenue(classified.venueId);
  return venue ? { ok: true, kind: "venue" } : { ok: false, reason: "refused" };
}

export async function resolveOpenPlanMeetingPoint(
  planId: string,
): Promise<OpenMeetingPointResolution> {
  const lookup = await planStateResult(planId);
  if (!lookup.ok) return { ok: false, reason: "unavailable" };
  if (!lookup.plan) return { ok: false, reason: "refused" };
  return resolveOpenMeetingFromStops(lookup.plan.stops);
}
