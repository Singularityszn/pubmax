import type { CityId } from "@/lib/cities";
import { nightAreaForMapQuery } from "@/lib/nightAreas";
import londonLocalities from "@/public/data/london_localities.json";

const normalizeAreaName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export function areaCircleForAsk(
  cityId: CityId,
  area: string | undefined,
): { lat: number; lng: number; radiusKm: number; label: string } | undefined {
  const nightArea = area ? nightAreaForMapQuery(cityId, area) : null;
  if (nightArea) {
    return { ...nightArea.centre, radiusKm: nightArea.radiusKm, label: nightArea.name };
  }
  if (!area || cityId !== "london") return undefined;
  const wanted = normalizeAreaName(area);
  const locality = londonLocalities.localities.find(
    (entry) => normalizeAreaName(entry.name) === wanted,
  );
  return locality
    ? { lat: locality.lat, lng: locality.lng, radiusKm: 1.5, label: locality.name }
    : undefined;
}
