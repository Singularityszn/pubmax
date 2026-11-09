import type { HarvestSource } from "../lib/harvest/sourcePolicy.ts";
import type { PintPricesListing } from "./lib/pintPricesListings.mjs";

type RobotsAsk = (url: string) => Promise<{ allowed: boolean; reason: string; evidence: string }>;

/** The sourceRegistry row this lane needs before it may send one request. */
export declare const PINT_PRICES_SOURCE_ID: "pint-prices-com";

/** The permitted source row, or a throw that names the captain's call. */
export declare function permittedPintPricesSource(source?: HarvestSource): HarvestSource;

/** Re-read the source, gated on its policy row, robots and its own host. */
export declare function collect(options?: {
  source?: HarvestSource;
  fetchImpl?: typeof fetch;
  robots?: RobotsAsk;
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<PintPricesRead>;

type PintPricesRead = {
  observations: Map<string, Set<number>>;
  listings: Map<string, PintPricesListing>;
  boroughPages: number;
  boroughPagesWithData: number;
  pubPages: number;
  pubPagesWithData: number;
};

/** Read every borough and pub page the sitemap lists, through any page reader. */
export declare function readPintPricesPages(
  fetchText: (url: string) => Promise<string>,
  origin: string,
  pause?: () => Promise<void>,
): Promise<PintPricesRead>;

/** Replay pages an earlier permitted collection saved, with nothing fetched. */
export declare function readCapture(
  dir: string,
): Promise<{ collectedAt: string; fetchText: (url: string) => Promise<string> }>;

/** The figure the source states today for one held row, or null when nothing was read. */
export declare function freshPriceFor(
  observations: Map<string, Set<number>>,
  row: {
    pub_name?: string;
    address?: string;
    pub_url?: string;
    constructed_pub_url?: string;
    pint_name: string;
    price_gbp: number | string;
  },
): number | null;
