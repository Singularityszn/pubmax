import type { RefreshProviderJob } from "./localRefreshProviders.d.mts";

export const MENU_TRANSPORTS: Readonly<Record<"browserbase" | "tavily", RefreshProviderJob>>;

export class HarvestMenuTransportError extends Error {
  code: string;
}

export function parseMenuTransportArg(argv?: string[]): "browserbase" | "tavily";

export function refreshJobForTransport(transport: string): RefreshProviderJob;

export function assertTransportCredentials(
  transport: string,
  environment?: Record<string, string | undefined>,
): void;

export function createMenuPageHarvester(input?: {
  transport?: "browserbase" | "tavily";
  sourceId?: string;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  renderBrowserPage?: (
    connectUrl: string,
    url: string,
  ) => Promise<{ markdown: string; links: string[] }>;
  crawlDelayMs?: number;
  extractBudget?: number;
}): {
  transport: "browserbase" | "tavily";
  job: RefreshProviderJob;
  crawlDelayMs: number;
  extractBudget: number;
  readonly extractsSpent: number;
  fetchMenuMarkdown(url: string): Promise<string>;
};
