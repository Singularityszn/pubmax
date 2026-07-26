import { readFileSync } from "node:fs";
import path from "node:path";

import {
  classifyChainPub,
  runCityEnrichment,
  selectCityPubs,
  type OsmPub,
  type TavilyEnrichmentResult,
} from "@/scripts/lib/tavilyPubEnrichment.mjs";

const CITY_ROTATION = [
  "manchester",
  "birmingham",
  "edinburgh",
  "glasgow",
  "leeds",
  "bristol",
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TAVILY_CRON_QUERY_CAP = 25;

type UkPack = { pubs?: OsmPub[] };

function loadUkPubs(): OsmPub[] {
  const filePath = path.join(process.cwd(), "data", "osm", "uk", "uk_osm_pubs.json");
  const pack = JSON.parse(readFileSync(filePath, "utf8")) as UkPack;
  return Array.isArray(pack.pubs) ? pack.pubs : [];
}

export type ScheduledCityEnrichment = TavilyEnrichmentResult & {
  startIndex: number;
};

export async function runScheduledCityEnrichment(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: number;
  maxQueries?: number;
}): Promise<ScheduledCityEnrichment> {
  const now = options.now ?? Date.now();
  const maxQueries = options.maxQueries ?? TAVILY_CRON_QUERY_CAP;
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
    fetchImpl: options.fetchImpl,
    maxQueries,
    startIndex,
    observedAt: new Date(now).toISOString(),
  });
}
