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

export type CorrectedRow = { venueKey: string; drinkName: string; category: string; correctedAt?: string };

export function readCorrectedRows(value: unknown): CorrectedRow[];

export function recordCorrectedRows(
  correctedRows: CorrectedRow[],
  options: {
    beforeUpdates: ManagedPrice[];
    afterUpdates: ManagedPrice[];
    cityVenueKeys: Set<string>;
    correctedAt: string;
  },
): CorrectedRow[];

/** The price updates a git ref holds, such as a closed nightly PR branch. */
export function readPriceUpdatesAt(ref: string, options?: { cwd?: string }): ManagedPrice[];

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
  options: {
    committedPrices: ManagedPrice[];
    rejectedRows: RejectedRow[];
    correctedRows?: CorrectedRow[];
    mergedThrough: string | null;
  },
): CityCheckpoint;

export function newestMergedNight(reports: unknown[]): string | null;

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
    /** Prices a reviewer corrected, which no reading overwrites. */
    correctedRows?: CorrectedRow[];
    /** The read time of the newest night whose PR merged, from the committed run reports. */
    mergedThrough?: string | null;
    onState?: (state: CityCheckpoint) => void;
  },
): Promise<{ runResult: TavilyEnrichmentResult; state: CityCheckpoint }>;
