import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { listEnabledCities } from "@/lib/cities";
import { curatedCrawlsForCityAsync } from "@/lib/cityStoryCatalog.async";
import { buildCityCrawlGroup, type CityCrawlGroup } from "@/lib/cityCrawlDirectory";

let cached: Promise<CityCrawlGroup[]> | null = null;

export function loadCityCrawlGroups(): Promise<CityCrawlGroup[]> {
  cached ??= readCityCrawlGroups().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function readCityCrawlGroups(): Promise<CityCrawlGroup[]> {
  let failed = false;
  const groups = await Promise.all(listEnabledCities().filter((city) => city.id !== "london").map(async (city) => {
    try {
      const crawls = await curatedCrawlsForCityAsync(city.id);
      if (crawls.length === 0) return null;
      const file = path.join(/* turbopackIgnore: true */ process.cwd(), "public", city.slimVenuesPath);
      const pack: unknown = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file, "utf8"));
      return buildCityCrawlGroup(city, crawls, pack);
    } catch {
      failed = true;
      return null;
    }
  }));
  if (failed) cached = null;
  return groups.filter((group): group is CityCrawlGroup => group !== null);
}
