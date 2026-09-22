export type EnrichmentCliArgs = {
  city: string;
  maxQueries: number;
  reset: boolean;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): EnrichmentCliArgs;

export function pruneManagedCityPrices<T extends {
  venueKey?: string;
  source?: { licence?: string; [key: string]: unknown };
}>(existing: T[], cityVenueKeys: Set<string>): T[];

export function partitionReportedPrices<T extends {
  venueKey?: string;
  observedAt?: string;
  source?: { licence?: string; url?: string };
}>(updates: T[], pages: Array<{
  venueKey?: string;
  officialUrl?: string;
  observedAt?: string;
}>): { retained: T[]; removed: T[] };
