// Types for scripts/harvest/uk-prices/tavilyLane.mjs. See menu-urls.d.mts for why
// a plain-ESM crawl module wears a sidecar.

import type { UkPriceReading } from "../../../lib/harvest/ukPriceCrawl";

export type TavilyLaneOutcome =
  | "priced"
  | "partial"
  | "chain-delegated"
  | "policy-refused-host"
  | "redirect-refused"
  | "refused-by-site"
  | "blocked-by-challenge"
  | "robots-disallowed"
  | "robots-unreadable"
  | "unreachable"
  | "no-address-to-bind"
  | "no-site-found"
  | "site-unbound"
  | "no-menu-page-found"
  | "menu-states-no-price"
  | "estate-page-names-no-pub"
  | "budget-spent";

export const TAVILY_LANE_OUTCOMES: ReadonlyArray<TavilyLaneOutcome>;
export const DISCOVERY_EXCLUDED_DOMAINS: ReadonlyArray<string>;

export function tavilyOutcomeNeedsRetry(outcome: TavilyLaneOutcome): boolean;

export function permittedTavilySite(url: string): boolean;
export function siteLinksFromPage(page: {
  ok: boolean;
  status?: number;
  body: string;
  finalUrl: string;
  pdf?: boolean;
  reason?: string;
  error?: string;
}): { menu: string[]; contact: string[]; pdf?: boolean; refusal?: string };

export type SnapshotPub = {
  osmId: string;
  name: string;
  postcode?: string | null;
  address?: string | null;
  locality?: string | null;
  website?: string | null;
  lat: number;
  lng: number;
};

export type SearchResult = { url: string; title: string; content: string };

export function discoveredSiteFor(
  pub: SnapshotPub,
  results: SearchResult[],
  options?: {
    stateOwner?: (host: string) => string | null;
    claimedBy?: (host: string) => string | null;
  },
): { host: string; siteUrl: string; seedUrls: string[] } | { refusal: "no-site-found"; evidence: string };

export type CreditBudget = {
  canSpend(credits: number): boolean;
  charge(credits: number): void;
  readonly spent: number;
  readonly limit: number;
};

export function createCreditBudget(limit: number): CreditBudget;

export type TavilyLaneTarget = {
  pub: SnapshotPub;
  venueId: string | null;
  siteUrl: string | null;
  pubsOnHost: number;
  discovered?: boolean;
  seedUrls?: string[];
  pendingUrls?: string[];
  completedUrls?: string[];
  addressBound?: boolean;
  priceKeys?: string[];
  bindingUrl?: string | null;
};

export type TavilyLaneDeps = {
  robots: (url: string) => Promise<{ allowed: boolean; reason?: string; robots?: string; evidence?: string }>;
  search: (query: string) => Promise<{ results: SearchResult[]; credits: number | null }>;
  siteSearch?: (host: string, name: string) => Promise<{ results: SearchResult[]; credits: number | null }>;
  siteLinks?: (url: string) => Promise<{ menu: string[]; contact: string[]; pdf?: boolean; refusal?: string }>;
  extract: (urls: string[]) => Promise<{
    pages: Array<{ url: string; markdown: string }>;
    failed: Array<{ url: string; error: string }>;
    credits: number | null;
  }>;
  readPdf?: (url: string) => Promise<{ text?: string; finalUrl?: string; error?: string; refusal?: string }>;
  render: null | ((url: string) => Promise<{ markdown: string; links: string[]; finalUrl: string }>);
  renderBudget?: { take(): boolean };
  readPrices: (markdown: string, ctx: { pubName: string; pageUrl: string }) => Promise<{ reading: UkPriceReading }>;
  stateOwner?: (host: string) => string | null;
  claimedBy?: (host: string) => string | null;
  claim?: (host: string, osmId: string) => void;
  onCredits?: (credits: { search?: number | null; extract?: number | null; pagesRead?: number }) => void;
};

export type TavilyLaneRow = {
  url: string;
  category: string;
  priceGbp: number;
  drinkLabel?: string;
  servingSize?: string;
  linesOnPage: number;
  renderer: "tavily" | "browserbase" | "pdf-text";
};

export type TavilyLaneResult = {
  osmId: string;
  venueId: string | null;
  host: string | null;
  siteUrl: string | null;
  seedUrls: string[];
  pendingUrls: string[];
  completedUrls: string[];
  priceKeys: string[];
  bindingUrl: string | null;
  outcome: TavilyLaneOutcome;
  evidence: string;
  discovered: boolean;
  addressBound: boolean;
  robots: string | null;
  searches: number;
  pagesRead: number;
  pages: Array<{ url: string; kind: string; via: string | null; error: string | null; figures: number | null }>;
  rendered: number;
  renderErrors: string[];
  refusals: Array<{ url: string; reason: string; evidence?: string }>;
  drops: string[];
  rows: TavilyLaneRow[];
};

export function harvestPubBatch(
  targets: TavilyLaneTarget[],
  deps: TavilyLaneDeps,
  budget: CreditBudget,
): Promise<TavilyLaneResult[]>;
