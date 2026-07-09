// City-keyed curated crawl selector. London crawls stay in lib/curatedCrawls.ts;
// Manchester / Glasgow packs live under lib/cities/{id}/curatedCrawls.ts.

import { parseCityId, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import {
  curatedCrawls,
  curatedCrawlById as londonCuratedCrawlById,
  type CuratedCrawl,
} from "@/lib/curatedCrawls";
import { manchesterCuratedCrawls } from "@/lib/cities/manchester/curatedCrawls";
import { glasgowCuratedCrawls } from "@/lib/cities/glasgow/curatedCrawls";

function resolveCityId(cityId: CityId | string | null | undefined): CityId {
  return parseCityId(cityId) ?? DEFAULT_CITY_ID;
}

export function curatedCrawlsForCity(
  cityId: CityId | string | null | undefined = DEFAULT_CITY_ID,
): CuratedCrawl[] {
  switch (resolveCityId(cityId)) {
    case "manchester":
      return manchesterCuratedCrawls;
    case "glasgow":
      return glasgowCuratedCrawls;
    case "london":
    default:
      return curatedCrawls;
  }
}

export function curatedCrawlByIdForCity(
  cityId: CityId | string | null | undefined,
  crawlId: string | null | undefined,
): CuratedCrawl | undefined {
  if (!crawlId) return undefined;
  const id = resolveCityId(cityId);
  if (id === "london") return londonCuratedCrawlById(crawlId);
  return curatedCrawlsForCity(id).find((crawl) => crawl.id === crawlId);
}
