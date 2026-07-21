import {
  activeNightSignalClaims,
  type NightSignalClaim,
} from "@/lib/nightSignalClaims";
import type { NightAreaSlug } from "@/lib/nightPlanning";
import {
  planningWeatherForArea,
  type PlanningWeather,
} from "@/lib/weatherSnapshots";
import {
  filterTonight,
  rowEffectiveEnd,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type PlanEvidenceWindow = {
  startsAt: string;
  endsAt: string;
};

export type PlanTemporalEvidence = {
  weather: PlanningWeather | null;
  whatsOn: WhatsOnRow[];
  signalClaims: NightSignalClaim[];
};

function overlapsWindow(
  startsAt: number,
  endsAt: number,
  window: PlanEvidenceWindow,
): boolean {
  const windowStart = Date.parse(window.startsAt);
  const windowEnd = Date.parse(window.endsAt);
  return startsAt < windowEnd && endsAt > windowStart;
}

function whatsOnForWindow(
  rows: WhatsOnRow[],
  requestNow: number,
  routeWindow: PlanEvidenceWindow | null,
): WhatsOnRow[] {
  if (!routeWindow) return filterTonight(rows, requestNow);
  return rows.filter((row) => {
    const observedAt = Date.parse(row.observedAt);
    return observedAt <= requestNow
      && overlapsWindow(Date.parse(row.startsAt), rowEffectiveEnd(row), routeWindow);
  });
}

function signalClaimsForWindow(
  snapshot: unknown,
  requestNow: number,
  routeWindow: PlanEvidenceWindow | null,
): NightSignalClaim[] {
  const availableClaims = activeNightSignalClaims(snapshot, requestNow);
  if (!routeWindow) return availableClaims;
  return availableClaims.filter((claim) => overlapsWindow(
    Date.parse(claim.observedAt),
    Date.parse(claim.expiresAt),
    routeWindow,
  ));
}

/**
 * Separates evidence availability at request time from applicability to the
 * planned visit. What's-On rows and reviewed claims carry effective intervals,
 * so dated routes use interval overlap. The weather snapshot is a current
 * observation whose expiry is a cache-freshness bound, not a forecast window;
 * it is therefore omitted for every explicitly future route.
 *
 * A request without an intake keeps the legacy request-time behaviour exactly.
 */
export function planTemporalEvidence(input: {
  weatherSnapshot: unknown;
  nightSignalSnapshot: unknown;
  whatsOnRows: WhatsOnRow[];
  nightArea: NightAreaSlug;
  requestNow: number;
  routeWindow?: PlanEvidenceWindow | null;
}): PlanTemporalEvidence {
  const routeWindow = input.routeWindow ?? null;
  return {
    weather: routeWindow
      ? null
      : planningWeatherForArea(input.weatherSnapshot, input.nightArea, input.requestNow),
    whatsOn: whatsOnForWindow(input.whatsOnRows, input.requestNow, routeWindow),
    signalClaims: signalClaimsForWindow(
      input.nightSignalSnapshot,
      input.requestNow,
      routeWindow,
    ),
  };
}
