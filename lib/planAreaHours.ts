import { haversineKm } from "@/lib/haversine";
import type { NightArea, NightAreaSlug } from "@/lib/nightAreas";
import { PLAN_TIME_NONE_LINE, PLAN_TIME_SOME_LINE } from "@/lib/planCopy";
import { PLAN_TIME_WINDOWS, type PlanTimeWindowId } from "@/lib/planIntake";

/**
 * Per area and time window, the most stops a route at that time can have. A
 * missing area or window fits none. Written by lib/planAreaHours.server.ts.
 */
export type PlanAreaTimeFits = Partial<Record<NightAreaSlug, Partial<Record<PlanTimeWindowId, number>>>>;

/** The generator's own area test: a pub within the area's radius of its centre. */
export function planAreaContains(area: Pick<NightArea, "centre" | "radiusKm">, venue: { lat: number; lng: number }): boolean {
  return haversineKm([area.centre.lng, area.centre.lat], [venue.lng, venue.lat]) <= area.radiusKm;
}

/**
 * Whether a time window can give this many stops here. Without the fits or an
 * area there is nothing to say, and the generator keeps the last word.
 */
export function planTimeWindowFits(
  fits: PlanAreaTimeFits | null,
  area: NightAreaSlug | null | undefined,
  windowId: PlanTimeWindowId,
  stopCount: number,
): boolean {
  if (!fits || !area) return true;
  return (fits[area]?.[windowId] ?? 0) >= stopCount;
}

/** The time windows that cannot give this many stops here, and the one line that says so. */
export function planTimeWindowsOff(
  fits: PlanAreaTimeFits | null,
  area: NightAreaSlug | null | undefined,
  stopCount: number,
): { off: ReadonlySet<PlanTimeWindowId>; line: string | null } {
  const off = new Set(PLAN_TIME_WINDOWS.flatMap(({ id }) => planTimeWindowFits(fits, area, id, stopCount) ? [] : [id]));
  return {
    off,
    line: off.size === 0 ? null : off.size === PLAN_TIME_WINDOWS.length ? PLAN_TIME_NONE_LINE : PLAN_TIME_SOME_LINE,
  };
}
