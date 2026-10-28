import type { HarvestSource } from "../lib/harvest/sourcePolicy.ts";

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
}): Promise<{
  observations: Map<string, Set<number>>;
  boroughPages: number;
  boroughPagesWithData: number;
  pubPages: number;
  pubPagesWithData: number;
}>;
