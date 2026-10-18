import type { FoodTarget } from "./lane.mjs";

export type FoodHarvestOptions = {
  source: "curated" | "osm" | "all";
  hosts: number | null;
  pages: number;
  renders: number;
  render: "auto" | "never" | "always";
  only: string | null;
  reset: boolean;
  recheck: string[];
  dryRun: boolean;
};

export declare function parseFoodHarvestArgs(argv: readonly string[]): FoodHarvestOptions;
export declare function ukBaseVenueId(osmId: unknown): string | null;
export declare function curatedFoodTargets(
  enrichment: { venues?: Record<string, { menuUrl?: string }> },
  slimRows: ReadonlyArray<{ id: string; name?: string }>,
): FoodTarget[];
export declare function osmFoodTargets(
  snapshot: unknown,
  curatedHosts: ReadonlySet<string>,
): FoodTarget[];
