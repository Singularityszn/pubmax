import type { CityId } from "@/lib/cities";
import { getNightAreasForCity } from "@/lib/nightAreas";

const MISS_AREA_NAME_LIMIT = 2;

/** Recognise a UK postcode or outward district, without claiming a location. */
export function isMapPostcodeQuery(query: string): boolean {
  return /^(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?(?:\s?\d[A-Z]{2})?)$/i.test(query.trim());
}

/** Areas a missed search may suggest: only ones this city's map search can find. */
export function mapSearchMissAreaNames(cityId: CityId, includeLocalResults: boolean): string[] {
  if (!includeLocalResults) return [];
  return getNightAreasForCity(cityId).slice(0, MISS_AREA_NAME_LIMIT).map((area) => area.name);
}
