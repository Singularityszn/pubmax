// Types for scripts/harvest/uk-prices/record-later-publications.mjs. See
// menu-urls.d.mts for why a plain-ESM crawl module wears a sidecar.

import type { RobotsChecker } from "../../../lib/harvest/robots.ts";

/** What a re-read of one source page answers for its receipt. */
export type EvidenceRead = {
  /** The page's own words around a recorded price, or why there are none. */
  evidence: string;
  /** The page that served `evidence`: the landing URL after any redirect. Absent when the page was not read. */
  evidenceUrl?: string;
  readAt: string;
};

export declare function readEvidence(
  url: string,
  rows: ReadonlyArray<{ priceGbp: number }>,
  robots: RobotsChecker,
  fetchImpl?: typeof fetch,
): Promise<EvidenceRead>;
