import { isNightAreaRouteReady, type NightArea } from "@/lib/nightAreas";

export function nightAreaCoverageDetail(area: NightArea, now: Date): string {
  if (isNightAreaRouteReady(area, now)) {
    return "Enough checked information to plan a crawl.";
  }
  return "Not enough checked information to plan a crawl here yet.";
}

export function getHomeEndingDescription(
  stationName: string | null,
  leaveByIso: string | null,
): string {
  return leaveByIso
    ? `Live leave-by time for ${stationName ?? "the nearest station"}.`
    : `Check ${stationName ?? "the nearest station"} before you confirm.`;
}

export function keepGoingDistanceDescription(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km straight-line`;
}

export function nextStopWalkDescription(minutes: number): string {
  return `about ${minutes} min on foot, straight-line estimate`;
}
