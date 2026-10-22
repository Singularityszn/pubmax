import type {
  HarvestUrlPolicy,
  HarvestedPageResult,
  RobotsChecker,
} from "../../lib/harvest/robots";

export function permittedSitemapUrls(
  xml: string,
  sourcePredicate: (url: string) => boolean,
): string[];

export function fetchSourceBoundPage(
  input: string | URL,
  robots: RobotsChecker,
  options: {
    sourcePredicate: (url: string) => boolean;
    init?: RequestInit;
    fetchImpl?: typeof fetch;
    urlPolicy?: HarvestUrlPolicy;
  },
): Promise<HarvestedPageResult>;
