import { haversineKm } from "@/lib/haversine";
import type { CityId } from "@/lib/cities";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";

/**
 * The night area a landmark sits INSIDE, or null.
 *
 * The map's top bar prints the area the reader CHOSE (a remembered choice,
 * `mapChipLabelFor` in components/PubMap.tsx), so a story opened from a pin
 * on the other side of town has to say for itself where it is, rather than
 * the bar being rewritten under a choice the reader made. This answers only
 * when the point is within an area's own radius: a landmark between areas
 * gets no area rather than the nearest one, because "In Barnes" over a pub
 * three miles from Barnes is a claim nobody checked.
 */
export function nightAreaContaining(
  cityId: CityId,
  point: [number, number],
): NightArea | null {
  let best: NightArea | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const area of getNightAreasForCity(cityId)) {
    const km = haversineKm(point, [area.centre.lng, area.centre.lat]);
    if (km <= area.radiusKm && km < bestKm) {
      best = area;
      bestKm = km;
    }
  }
  return best;
}

/** The one line a story prints about where it is. */
export function landmarkAreaLine(area: NightArea | null): string | null {
  return area ? `In ${area.name}` : null;
}
