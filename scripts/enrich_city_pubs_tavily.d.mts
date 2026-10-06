import type { OsmPub, runCityEnrichment, TavilyEnrichmentResult } from "./lib/tavilyPubEnrichment.mjs";

export type EnrichmentCliArgs = {
  city: string;
  maxQueries: number;
  maxCredits: number;
  reset: boolean;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): EnrichmentCliArgs;

export function pruneManagedCityPrices<T extends {
  venueKey?: string;
  source?: { licence?: string; [key: string]: unknown };
}>(existing: T[], cityVenueKeys: Set<string>): T[];

type ManagedPrice = {
  venueKey: string;
  drinkName: string;
  category: string;
  source?: { licence?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type CityCheckpoint = {
  version: 2;
  city: string;
  totalPubs: number;
  observedAt: string;
  /** When each pub was last read, by OSM id. A failed search is not a read. */
  readAt: Record<string, string>;
  totalQueriesSpent: number;
  totalCreditsSpent: number;
  prices: ManagedPrice[];
  /** Every reading the committed data has held, so one a reviewer removed is not re-added. */
  committedReadings: string[];
  pages: Array<Record<string, unknown>>;
  delegatedChains: Array<Record<string, unknown>>;
};

export function committedCityPrices<T extends ManagedPrice>(
  existing: T[],
  cityVenueKeys: Set<string>,
): T[];

export type RejectedRow = { venueKey: string; sourceUrl: string; rejectedAt?: string };

export function loadCityPubs(cityId: string): OsmPub[];

export function readRejectedRows(value: unknown): RejectedRow[];

export function rejectClosedPrRows(
  rejectedRows: RejectedRow[],
  options: {
    prUpdates: ManagedPrice[];
    committedUpdates: ManagedPrice[];
    cityVenueKeys: Set<string>;
    rejectedAt: string;
  },
): RejectedRow[];

export function resumeCheckpoint(
  saved: unknown,
  options: {
    city: string;
    totalPubs: number;
    cityVenueKeys: Set<string>;
    observedAt: string;
    reset?: boolean;
  },
): CityCheckpoint;

export function reconcileWithCommitted(
  state: CityCheckpoint,
  options: { committedPrices: ManagedPrice[]; rejectedRows: RejectedRow[] },
): CityCheckpoint;

export function stalestFirst(pubs: OsmPub[], readAt: Record<string, string>): number[];

export function runCityPass(
  options: Omit<
    Parameters<typeof runCityEnrichment>[0],
    "indices" | "startIndex" | "onProgress" | "observedAt"
  > & {
    checkpoint: CityCheckpoint;
    observedAt: string;
    committedPrices: ManagedPrice[];
    rejectedRows?: RejectedRow[];
    onState?: (state: CityCheckpoint) => void;
  },
): Promise<{ runResult: TavilyEnrichmentResult; state: CityCheckpoint }>;
