// Curated crawl hydration for map mount seed — split from @/lib/pubMap so the
// eager map shell does not static-import the crawl catalog on a plain /map open.

import type { Filters } from "@/lib/venues";
import {
  curatedCrawls,
  curatedCrawlById,
  type CuratedCrawl,
} from "@/lib/curatedCrawls";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { seedCrawlState } from "@/lib/crawlUrl";
import { isDrinkShapeArrival } from "@/lib/mapArrival";
import {
  filtersForCuratedCrawl,
  type MapSeed,
} from "@/lib/pubMap";

/** Resolve a curated crawl from ?crawl= or an exact pubs= stop list match (London). */
export function resolveSeededCuratedCrawl(
  cityId: CityId,
  crawlId: string | undefined,
  builtIds: string[],
): CuratedCrawl | null {
  const isLondon = cityId === DEFAULT_CITY_ID || cityId === "london";
  if (crawlId) {
    if (!isLondon) return null;
    const byId = curatedCrawlById(crawlId);
    if (byId) return byId;
  }
  if (!isLondon || builtIds.length < 2) return null;
  return (
    curatedCrawls.find(
      (crawl) =>
        crawl.venueIds.length === builtIds.length &&
        crawl.venueIds.every((id, i) => id === builtIds[i]),
    ) ?? null
  );
}

/** Whether the URL needs the crawl catalog to finish seeding. */
export function mapSeedNeedsCuratedCrawlLookup(search: string): boolean {
  if (isDrinkShapeArrival(search)) return false;
  const seeded = seedCrawlState(search);
  return Boolean(seeded.crawlId) || seeded.builtIds.length >= 2;
}

/**
 * Full mount seed including curated crawl hydration. Used by tests and by the
 * async PubMap layout effect — not the eager map shell chunk.
 */
export function buildMapSeedWithCuratedCrawl(
  search: string,
  cityId: CityId = DEFAULT_CITY_ID,
): MapSeed {
  const seeded = seedCrawlState(search);
  if (isDrinkShapeArrival(search)) {
    return { ...seeded, activeCrawl: null, routeMapped: false };
  }
  const activeCrawl = resolveSeededCuratedCrawl(cityId, seeded.crawlId, seeded.builtIds);
  if (activeCrawl) {
    return {
      ...seeded,
      filters: filtersForCuratedCrawl(seeded.filters, activeCrawl),
      altStyle: activeCrawl.altStyle ?? seeded.altStyle,
      crawlId: activeCrawl.id,
      activeCrawl,
      routeMapped: true,
    };
  }
  return {
    ...seeded,
    activeCrawl: null,
    routeMapped: seeded.builtIds.length >= 2,
  };
}

export type CuratedCrawlHydration = {
  crawl: CuratedCrawl;
  filters: Filters;
  altStyle: MapSeed["altStyle"];
  crawlId: string;
  routeMapped: boolean;
};

/** Apply a resolved crawl onto live PubMap state after the catalog chunk loads. */
export function curatedCrawlHydrationFromSeed(
  search: string,
  cityId: CityId,
): CuratedCrawlHydration | null {
  if (!mapSeedNeedsCuratedCrawlLookup(search)) return null;
  const seeded = seedCrawlState(search);
  const crawl = resolveSeededCuratedCrawl(cityId, seeded.crawlId, seeded.builtIds);
  if (!crawl) return null;
  return {
    crawl,
    filters: filtersForCuratedCrawl(seeded.filters, crawl),
    altStyle: crawl.altStyle ?? seeded.altStyle,
    crawlId: crawl.id,
    routeMapped: true,
  };
}
