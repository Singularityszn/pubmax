import type { CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import type { DealProximityAnchor } from "@/lib/dealsHonestyCore";

export * from "@/lib/dealsHonestyCore";

/**
 * The one point a deal surface is allowed to measure from: the centre of the
 * viewer's nearest night area. Public, fixed, and shared by everyone standing
 * in that area, so the ordering can be "near you" without a deal path ever
 * holding a viewer's own coordinates. Returns null when there is no location to
 * work from, and the surfaces then order by closing time alone.
 */
export function dealProximityAnchor(
  viewer: { lat: number; lng: number } | null | undefined,
  cityId: CityId = "london",
): DealProximityAnchor | null {
  if (!viewer || !Number.isFinite(viewer.lat) || !Number.isFinite(viewer.lng)) return null;
  const area = nearestNightAreaForViewport(cityId, [viewer.lng, viewer.lat]);
  if (!area) return null;
  return { lat: area.centre.lat, lng: area.centre.lng };
}
