import type { FoodCategory, UkFoodDropReason } from "../../../lib/harvest/ukFoodCrawl.ts";

type RobotsAnswer = { allowed: boolean; reason: string; robots?: string; evidence: string; sitemaps?: string[] };

export type FoodTarget = {
  venueId: string;
  venueKey: string;
  name: string | null;
  website?: string;
  menuUrls: string[];
  source?: "curated" | "osm";
};

export type FoodHostEntry = { host: string; origin: string; pubs: FoodTarget[] };

export type ServedPage = {
  ok: boolean;
  status: number;
  url: string;
  contentType?: string;
  body: string | Uint8Array;
};

export type RenderedPage = { markdown: string; links?: string[]; finalUrl: string };

export type FoodHarvestDeps = {
  robots: (url: string) => Promise<RobotsAnswer>;
  fetchServed: (url: string) => Promise<ServedPage>;
  renderPage?: (url: string) => Promise<RenderedPage>;
  renderMode?: "auto" | "never" | "always";
  readPdf: (bytes: Uint8Array) => Promise<string | null>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  pagesPerHost?: number;
  pageBudget?: number;
  renderBudget?: number;
};

export type FoodHarvestRow = {
  venueKey: string;
  venueId: string;
  itemName: string;
  category: FoodCategory;
  priceGbp: number;
  source: { label: string; url: string; licence: string };
  observedAt: string;
  readVia: "served" | "rendered" | "pdf";
  quote: string;
};

export type FoodLedgerPage = { url: string; landedOn?: string; outcome: string; readVia?: string; dishes: number };

export type FoodLedgerRow = {
  host: string;
  origin: string;
  pubs: number;
  checkedAt: string;
  outcome: string;
  robots?: string;
  evidence?: string;
  pagesRead: number;
  rows?: number;
  pages?: FoodLedgerPage[];
};

export type FoodHarvestResult = {
  ledger: Record<string, FoodLedgerRow>;
  rows: FoodHarvestRow[];
  summary: {
    hosts: number;
    outcomes: Record<string, number>;
    rows: number;
    venuesPriced: number;
    drops: Partial<Record<UkFoodDropReason, number>>;
    pdfUnread: number;
    renders: number;
    rendersSkippedOverBudget: number;
    pageBudgetLeft: number | null;
  };
};

export declare const FIRST_PARTY_FOOD_LICENCE: string;
export declare const DEFAULT_FOOD_PAGES_PER_HOST: number;
export declare const FOOD_HOST_OUTCOMES: readonly string[];
export declare function groupFoodTargetsByHost(targets: readonly FoodTarget[]): FoodHostEntry[];
export declare function harvestFood(hostEntries: readonly FoodHostEntry[], deps: FoodHarvestDeps): Promise<FoodHarvestResult>;
