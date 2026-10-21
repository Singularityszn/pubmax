import { cityAwareMapPath } from "@/lib/cityMapHref";
import type { CityId } from "@/lib/cities";
import { DEFAULT_AREA_FLY_ZOOM } from "@/lib/areaButton";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import type { MapViewportSnapshot } from "@/lib/mobileShell";

export function mapAreaHref(area: NightArea) {
  return cityAwareMapPath(area.cityId, new URLSearchParams({ area: area.slug }));
}

export function parseMapAreaArrival(search: string, cityId: CityId): NightArea | null {
  const params = new URLSearchParams(search);
  if (params.get("q")?.trim() || params.get("sel")?.trim()) return null;
  const slug = params.get("area");
  return getNightAreasForCity(cityId).find((area) => area.slug === slug) ?? null;
}

export function mapAreaOpeningView(
  area: NightArea | null,
  cityView: Omit<MapViewportSnapshot, "pitch" | "bearing"> & Partial<Pick<MapViewportSnapshot, "pitch" | "bearing">>,
): MapViewportSnapshot | null {
  return area ? {
    ...cityView,
    center: [area.centre.lng, area.centre.lat],
    zoom: DEFAULT_AREA_FLY_ZOOM,
    pitch: cityView.pitch ?? 0,
    bearing: cityView.bearing ?? 0,
  } : null;
}
