import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyChainPub,
  runCityEnrichment,
  selectCityPubs,
  type OsmPub,
  type TavilyEnrichmentResult,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";
import { DAY_MS } from "@/lib/dayMs";
import type { SearchProvider } from "@/lib/searchProvider.server";

// London leads the rotation. It was absent from it entirely until 2026-08-16,
// so no London pub had ever reached this seam, while the site's whole price
// story is a London one.
const CITY_ROTATION = [
  "london",
  "manchester",
  "birmingham",
  "edinburgh",
  "glasgow",
  "leeds",
  "bristol",
] as const;
export const SEARCH_CRON_QUERY_CAP = 25;

type UkPack = { pubs?: OsmPub[] };

function loadUkPubs(): OsmPub[] {
  const filePath = path.join(process.cwd(), "data", "osm", "uk", "uk_osm_pubs.json");
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as UkPack;
  return Array.isArray(pack.pubs) ? pack.pubs : [];
}

export type ScheduledCityEnrichment = TavilyEnrichmentResult & {
  startIndex: number;
};

export type ScheduledEnrichmentProgress = {
  city: string;
  nextIndex: number;
  queriesSpent: number;
  creditsSpent: number;
  prices: TavilyEnrichmentResult["prices"];
  pages: TavilyEnrichmentResult["pages"];
  delegatedChains: TavilyEnrichmentResult["delegatedChains"];
};

export async function runScheduledCityEnrichment(options: {
  apiKey?: string;
  searchProvider?: SearchProvider;
  fetchImpl?: typeof fetch;
  now?: number;
  maxQueries?: number;
  onProgress?: (progress: ScheduledEnrichmentProgress) => void | Promise<void>;
}): Promise<ScheduledCityEnrichment> {
  const now = options.now ?? Date.now();
  const maxQueries = options.maxQueries ?? SEARCH_CRON_QUERY_CAP;
  const epochDay = Math.floor(now / DAY_MS);
  const city = CITY_ROTATION[epochDay % CITY_ROTATION.length];
  const pubs = selectCityPubs(city, loadUkPubs()).filter(
    (pub) => Boolean(pub.website) && !classifyChainPub(pub),
  );
  const completedRotations = Math.floor(epochDay / CITY_ROTATION.length);
  const startIndex = pubs.length > 0 ? (completedRotations * maxQueries) % pubs.length : 0;
  return runCityEnrichment({
    city,
    pubs,
    apiKey: options.apiKey,
    searchProvider: options.searchProvider,
    fetchImpl: options.fetchImpl,
    maxQueries,
    startIndex,
    observedAt: new Date(now).toISOString(),
    onProgress: options.onProgress
      ? async (state) => {
          await options.onProgress?.({
            city,
            ...(state as Omit<ScheduledEnrichmentProgress, "city">),
          });
        }
      : undefined,
  });
}
