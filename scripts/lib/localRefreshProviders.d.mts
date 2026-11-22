export type RefreshProviderJob = "pub-discovery" | "rendered-menu" | "plain-page";
export type RefreshProviderName = "exa" | "browserbase" | "tavily";

export const PROVIDER_POLICY: Readonly<
  Record<RefreshProviderJob, Readonly<{ provider: RefreshProviderName; key: string }>>
>;

export class RefreshProviderError extends Error {
  provider: RefreshProviderName;
  status?: number;
}

export function providerForJob(
  job: RefreshProviderJob,
): Readonly<{ provider: RefreshProviderName; key: string }>;

export function assertProviderCredentials(
  jobs: RefreshProviderJob[],
  environment?: Record<string, string | undefined>,
): void;

export function discoverRefreshPages(input: {
  query: string;
  includeDomains?: string[];
  numResults?: number;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ url: string; title: string; text: string }>>;

export function renderBrowserbasePage(
  connectUrl: string,
  url: string,
  WebSocketImpl?: typeof WebSocket,
): Promise<{ markdown: string; links: string[]; finalUrl: string }>;

export function fetchRefreshPage(input: {
  job: "rendered-menu" | "plain-page";
  url: string;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  renderBrowserPage?: (
    connectUrl: string,
    url: string,
  ) => Promise<{ markdown: string; links: string[]; finalUrl: string }>;
}): Promise<{ markdown: string; links: string[]; finalUrl: string }>;

export const TAVILY_EXTRACT_BATCH: number;

export function fetchTinyfishPage(input: {
  url: string;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{ markdown: string; links: string[]; finalUrl: string; via: "tinyfish" }>;

export function searchTavilySites(input: {
  query: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  maxResults?: number;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{
  results: Array<{ url: string; title: string; content: string }>;
  credits: number | null;
}>;

export function extractTavilyPages(input: {
  urls: string[];
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<{
  pages: Array<{ url: string; markdown: string }>;
  failed: Array<{ url: string; error: string }>;
  credits: number | null;
}>;

export function readTavilyRemainingCredits(input?: {
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<number | null>;
