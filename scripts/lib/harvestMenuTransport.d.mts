import type { RefreshProviderJob } from "./localRefreshProviders.d.mts";
import type { RobotsChecker } from "../../lib/harvest/robots.ts";

export type MenuTransport = "browserbase" | "tavily" | "playwright";

export const MENU_TRANSPORTS: Readonly<Record<MenuTransport, string>>;

export class HarvestMenuTransportError extends Error {
  code: string;
}

export function parseMenuTransportArg(argv?: string[], defaultTransport?: MenuTransport): MenuTransport;

export function refreshJobForTransport(transport: string): RefreshProviderJob;

export function assertTransportCredentials(
  transport: string,
  environment?: Record<string, string | undefined>,
): void;

export function assertLocalPolicyEnforcedTransport(transport: MenuTransport): void;

export function createMenuPageHarvester(input?: {
  transport?: MenuTransport;
  sourceId?: string;
  associatedHosts?: readonly string[];
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  renderBrowserPage?: (
    connectUrl: string,
    url: string,
  ) => Promise<{ markdown: string; links: string[] }>;
  fetchLocalPlaywrightMenuPage?: (
    url: string,
    options: {
      sourceId: string;
      associatedHosts: readonly string[];
      robotsChecker: RobotsChecker;
      followMenuLink: boolean;
    },
  ) => Promise<{ markdown: string; links: string[]; finalUrl?: string }>;
  robotsChecker?: RobotsChecker;
  crawlDelayMs?: number;
  extractBudget?: number;
}): {
  transport: MenuTransport;
  job: RefreshProviderJob | null;
  crawlDelayMs: number;
  extractBudget: number;
  readonly extractsSpent: number;
  readonly lastRobotsDisallowed: boolean;
  readonly lastFinalUrl: string | null;
  waitForCrawlSpacing(): Promise<void>;
  markRequestCompleted(): void;
  fetchMenuMarkdown(url: string): Promise<string>;
};
