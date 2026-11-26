// Types for scripts/harvest/uk-prices/record-later-publications.mjs. See
// menu-urls.d.mts for why a plain-ESM crawl module wears a sidecar.

import type { RobotsChecker } from "../../../lib/harvest/robots.ts";
import type { DrinkCategory } from "../../../lib/drinks.ts";

/** A £ figure on the captured page that published no row, with why. */
export type CapturedPriceOmission = {
  priceGbp: number;
  /** The printed figure, when the reader dropped it. */
  verbatim?: string;
  /** The drinks heading the figure sat under, or null when it sat outside one. */
  section: string | null;
  reason: string;
  /** Set when a read row was skipped by the recorder rather than the reader. */
  drinkLabel?: string;
};

export declare function readCapturedSectionPrices(
  text: string,
  candidateNames?: readonly string[],
  omissions?: CapturedPriceOmission[],
): Array<{ drinkLabel: string; category: DrinkCategory; priceGbp: number; servingSize?: string }>;

/** What a re-read of one source page answers for its receipt. */
export type EvidenceRead = {
  /** Complete menu text containing a recorded price, or why there is none. */
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
