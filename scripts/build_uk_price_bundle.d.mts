import type { BranchIdentity } from "../lib/harvest/ukPriceCrawl.ts";
import type { UkPriceBundleRow } from "../lib/ukPriceBundle.ts";

/** The drop counts the site-harvest lane writes into the build report. */
export type SiteHarvestLaneReport = {
  droppedRefusedHost: number;
  droppedOtherBranch: number;
  droppedUnresolvedVenue: number;
};

export declare function osmPubIdentities(
  snapshotPubs: ReadonlyArray<Record<string, unknown>>,
): Map<string, BranchIdentity>;

export declare function addSiteHarvestRows(
  harvestRows: ReadonlyArray<Record<string, unknown>>,
  options: {
    owners: ReadonlyMap<string, string>;
    servedRefs: ReadonlySet<string>;
    push: (row: UkPriceBundleRow) => void;
    report: SiteHarvestLaneReport;
    boundaries?: unknown;
    venueAliases?: Record<string, string>;
    pubIdentities?: ReadonlyMap<string, BranchIdentity>;
  },
): void;
