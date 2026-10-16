import type { HarvestReporter } from "../../lib/harvest/runReport.ts";

type RobotsAsk = (url: string) => Promise<{ allowed: boolean; reason: string; evidence: string }>;

type ScrapedPage = {
  url: string;
  landedUrl: string | null;
  markdown: string;
  statusCode: number | null;
  cacheState: string | null;
  cachedAt: string | null;
};

type ScrapeOutcome =
  | { ok: true; page: ScrapedPage }
  | { ok: false; failure: { reason: string; detail: string; status?: number } };

type SearchOutcome =
  | { ok: true; results: Array<{ url: string; title?: string; description?: string }> }
  | { ok: false; failure: { reason: string; detail: string; status?: number } };

type HarvestClient = {
  scrape: (url: string, options?: { maxAgeMs?: number; onlyMainContent?: boolean }) => Promise<ScrapeOutcome>;
  search: (query: string, options?: { limit?: number }) => Promise<SearchOutcome>;
};

/** Whether the page a scrape landed on may be used, and its URL when it may. */
export declare function scrapeLanding(
  url: string,
  page: { landedUrl: string | null },
  robots: RobotsAsk | null,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }>;

type Venue = { name: string; address: string; lat: number | null; lng: number | null };

export declare function harvestEvents(input: {
  client: HarvestClient | null;
  reporter: HarvestReporter;
  robots: RobotsAsk;
  observedAt: string;
  nowMs: number;
  venueIndex: unknown;
  dryRun: boolean;
  venueLimit: number;
  fresh: boolean;
  venues?: Array<Venue & { website: string; listingsLikely?: boolean }>;
  samePauseMs?: number;
}): Promise<{ rows: number }>;

export declare function harvestFacts(input: {
  client: HarvestClient | null;
  reporter: HarvestReporter;
  robots: RobotsAsk;
  observedAt: string;
  venueIndex: unknown;
  dryRun: boolean;
  venueLimit: number;
  fresh: boolean;
  venues?: Venue[];
  venuePaceMs?: number;
}): Promise<{ rows: number }>;
