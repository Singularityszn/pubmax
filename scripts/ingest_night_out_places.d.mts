export type PlaceIngestCategory = "restaurant" | "attraction";
export type PlaceDiscoveryProvider = "exa" | "firecrawl";

export type PlaceDiscovery = {
  category: PlaceIngestCategory;
  discoveredVia: PlaceDiscoveryProvider;
  url: string;
  rawHtml?: string | null;
};

export type IngestedNightOutPlace = {
  id: string;
  category: PlaceIngestCategory;
  job: "near_pub_food" | "pre_pub_attraction";
  name: string;
  description: string;
  address: string;
  area: string;
  location: { lat: number; lng: number };
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  expiresAt: string;
  discoveredVia: PlaceDiscoveryProvider;
  extractedVia: "firecrawl";
};

export const PLACE_QUERY_SET: ReadonlyArray<{
  category: PlaceIngestCategory;
  query: string;
}>;

export function normalizeSourceUrl(value: unknown): string | null;
export function sourceNameFromUrl(value: unknown): string | null;
export function parseJsonLdBlocks(rawHtml: unknown): Array<Record<string, unknown>>;
export function sourcePageToPlace(
  page: { url?: unknown; rawHtml?: unknown },
  options: {
    category: PlaceIngestCategory;
    discoveredVia: PlaceDiscoveryProvider;
    observedAt: string;
  },
): IngestedNightOutPlace | null;
export function buildPlaceRows(
  discoveries: PlaceDiscovery[],
  options: { observedAt: string },
): IngestedNightOutPlace[];

export class ProviderHaltError extends Error {
  provider: string;
  reason: string;
  status: number | null;
  constructor(provider: string, reason: string, status?: number | null);
}

export function classifyProviderFailure(
  provider: string,
  status: number,
): ProviderHaltError;
export function fetchDiscoveries(
  options: {
    exaKey?: string;
    firecrawlKey?: string;
    limit?: number;
  },
  fetchImpl?: typeof fetch,
  lookupImpl?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>,
): Promise<PlaceDiscovery[]>;
export function isPublicIpAddress(address: string): boolean;
export function createPublicDnsGuard(
  lookupImpl?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>,
): (value: unknown) => Promise<string>;
export function mergePlaceRows<T extends { id?: string }>(
  existing: T[],
  incoming: T[],
): T[];
export function isValidPlaceSnapshot(snapshot: unknown): boolean;
export function loadCurrentPlaces(
  nowMs: number,
  outputPath?: string,
): IngestedNightOutPlace[];
export function writeSnapshot(snapshot: unknown, outputPath?: string): void;
export function runIngestion(options?: {
  dryRun?: boolean;
  limit?: number;
  observedAt?: string;
  outputPath?: string;
  exaKey?: string;
  firecrawlKey?: string;
  fetchImpl?: typeof fetch;
  lookupImpl?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>;
}): Promise<unknown>;
