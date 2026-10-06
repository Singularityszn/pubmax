import type { CityId } from "@/lib/cities";
import { nightAreaForMapQuery } from "@/lib/nightAreas";

/**
 * A named night area ("Soho") is a circle on the map, which finds the pubs the
 * borough label hides. Any other area word has no circle and keeps the text
 * rules in rankConciergeVenues. Shared by the Ask tools and the Pal eval's
 * independent answer-key resolver, so the two cannot drift.
 */
export function areaCircleForAsk(
  cityId: CityId,
  area: string | undefined,
): { lat: number; lng: number; radiusKm: number } | undefined {
  const nightArea = area ? nightAreaForMapQuery(cityId, area) : null;
  return nightArea
    ? { ...nightArea.centre, radiusKm: nightArea.radiusKm }
    : undefined;
}
