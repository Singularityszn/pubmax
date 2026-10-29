import type { Route } from "next";
import { pointInCityBounds, type CityConfig, type CityId } from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";

export type CityCrawlGroup = {
  cityId: CityId;
  cityName: string;
  priceNote: string | null;
  crawls: { id: string; name: string; stops: number; href: Route }[];
};

/** A link promises the whole route, so every stop must resolve in its own city. */
export function buildCityCrawlGroup(
  city: CityConfig,
  crawls: readonly CuratedCrawl[],
  pack: unknown,
): CityCrawlGroup | null {
  if (!city.enabled || city.id === "london" || !pack || typeof pack !== "object") return null;
  const { revision, rows } = pack as { revision?: unknown; rows?: unknown };
  if (typeof revision !== "string" || !revision.trim() || !Array.isArray(rows)) return null;
  const placedIds = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, lat, lng } = row as { id?: unknown; lat?: unknown; lng?: unknown };
    if (typeof id !== "string" || typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !pointInCityBounds(lat, lng, city)) continue;
    placedIds.add(id);
  }
  const valid = crawls.filter((crawl) =>
    crawl.venueIds.length >= 2 && crawl.venueIds.every((id) => placedIds.has(id)),
  );
  if (valid.length === 0) return null;
  const prices = getCityCapabilityProfile(city.id).prices;
  return {
    cityId: city.id,
    cityName: city.displayName,
    priceNote: prices.availability === "available" ? null : prices.explanation,
    crawls: valid.map((crawl) => ({
      id: crawl.id,
      name: crawl.name,
      stops: crawl.venueIds.length,
      href: curatedCrawlMapHref(crawl, city.id),
    })),
  };
}
