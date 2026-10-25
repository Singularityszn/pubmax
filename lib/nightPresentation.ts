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

function formatCoverageDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

/** Keep the review window visible anywhere coverage is presented. */
export function nightAreaCoverageMeta(area: NightArea, now = new Date()): string {
  const reviewed = formatCoverageDate(area.lastReviewedAt);
  const expires = formatCoverageDate(area.reviewExpiresAt);
  if (!reviewed) return "Not checked yet.";
  if (!expires) return `Last checked ${reviewed}.`;
  const expiry = Date.parse(area.reviewExpiresAt ?? "");
  if (Number.isFinite(expiry) && expiry <= now.getTime()) {
    return `Last checked ${reviewed} · review expired ${expires}.`;
  }
  return `Last checked ${reviewed} · review through ${expires}.`;
}
