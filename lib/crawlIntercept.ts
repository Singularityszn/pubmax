import type { PlanState, PlanStopDTO } from "@/lib/plan";

/** Public choices for how many minutes away a late-arriving guest is. */
export const INTERCEPT_ETA_OPTIONS = [0, 15, 30, 45, 60] as const;

export type InterceptEtaMinutes = (typeof INTERCEPT_ETA_OPTIONS)[number];
export type InterceptTargetKind = "current" | "ahead" | "final";

export type InterceptRecommendation = {
  stop: PlanStopDTO;
  /** Index in the position-sorted route, not the stop's stored position. */
  targetIndex: number;
  /** First uncompleted stop, or the final stop when the crawl is complete. */
  currentIndex: number;
  etaMinutes: InterceptEtaMinutes;
  kind: InterceptTargetKind;
};

function normalizeEtaMinutes(value: unknown): InterceptEtaMinutes {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed)) return INTERCEPT_ETA_OPTIONS[0];

  let nearest: InterceptEtaMinutes = INTERCEPT_ETA_OPTIONS[0];
  let nearestDistance = Math.abs(parsed - nearest);
  for (const option of INTERCEPT_ETA_OPTIONS.slice(1)) {
    const distance = Math.abs(parsed - option);
    // A tie keeps the lower option, avoiding an optimistic over-estimate.
    if (distance < nearestDistance) {
      nearest = option;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Recommend the pub where a late arrival should intercept a crawl.
 *
 * Progress is deliberately evidence-based: only a recorded arrival or skip
 * completes a stop. Action order and duplicate events do not affect the result.
 * A 35-minute dwell assumption advances the target from the current stop, with
 * the result clamped to the final pub in the route.
 */
export function recommendCrawlIntercept(
  state: PlanState,
  etaMinutes: unknown,
): InterceptRecommendation | null {
  const stops = [...state.stops].sort((a, b) => a.position - b.position);
  if (stops.length === 0) return null;

  const completedPositions = new Set<number>();
  for (const action of state.actions ?? []) {
    if (
      action.stopPosition !== null
      && (action.type === "arrived" || action.type === "skipped")
    ) {
      completedPositions.add(action.stopPosition);
    }
  }

  const firstUncompleted = stops.findIndex((stop) => !completedPositions.has(stop.position));
  const currentIndex = firstUncompleted === -1 ? stops.length - 1 : firstUncompleted;
  const normalizedEta = normalizeEtaMinutes(etaMinutes);
  const stopsAhead = Math.floor(normalizedEta / 35);
  const targetIndex = Math.min(currentIndex + stopsAhead, stops.length - 1);
  const kind: InterceptTargetKind = targetIndex === stops.length - 1
    ? "final"
    : targetIndex === currentIndex
      ? "current"
      : "ahead";

  return {
    stop: stops[targetIndex],
    targetIndex,
    currentIndex,
    etaMinutes: normalizedEta,
    kind,
  };
}
