import type { CityId } from "@/lib/cities";
import { nightAreaForMapQuery } from "@/lib/nightAreas";

export function areaCircleForAsk(
  cityId: CityId,
  area: string | undefined,
): { lat: number; lng: number; radiusKm: number; label: string } | undefined {
  const nightArea = area ? nightAreaForMapQuery(cityId, area) : null;
  return nightArea
    ? { ...nightArea.centre, radiusKm: nightArea.radiusKm, label: nightArea.name }
    : undefined;
}
