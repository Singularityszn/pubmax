// The ONE Context.dev wrapper for server-side web reads.
//
// EVERY call this codebase makes to Context.dev goes through here. The official
// SDK (`context.dev`, pinned) is the transport, so endpoint paths, parameter
// names and response shapes come from the vendor rather than from a hand-rolled
// copy of them; what this module owns is the part the SDK cannot know about:
// the key, the retry policy, the per-run credit budget, and the PERMISSION
// GATE.
//
// THE GATE IS THE POINT. Context.dev is a FETCH LAYER, NEVER A PERMISSION. A
// URL reaches the network only when `lib/harvest/sourcePolicy.ts` does not
// refuse its host AND either that table already records a permission for the
// host or the caller hands in the live robots check from
// `lib/harvest/robots.ts`. A refusal costs no credit, because the guard runs
// before anything is sent.
//
// Key is read at call time, never logged. Without CONTEXT_DEV_API_KEY every
// call answers { status: "not-configured" } and sends nothing. Retries honour
// Retry-After on 429 and bounded backoff on 408/5xx; validation answers (4xx
// except 408/429) are returned immediately and never retried.
//
// This module carries NO `server-only` marker, for the same reason
// lib/harvest/firecrawl.ts carries none: a plain-node CLI
// (scripts/whatson/eventsRefresh.mjs) imports the events lane that sits on top
// of it, and `server-only` resolves to a module that THROWS on import outside a
// React Server Component. Nothing in app code imports it. If an app caller
// appears, `__tests__/serverOnlyGuard.test.ts` is where to demand the door.
//
// Docs: https://docs.context.dev (append .md to any page for Markdown).

import ContextDev, { APIError } from "context.dev";

import type { RobotsChecker } from "./harvest/robots.ts";
import { hasRecordedHarvestPermission, isHarvestableOperatorUrl } from "./harvest/sourcePolicy.ts";

const CONTEXT_DEV_API_BASE = "https://api.context.dev/v1";

export const CONTEXT_DEV_MAX_ATTEMPTS = 3;

const CONTEXT_DEV_RETRY_BASE_DELAY_MS = 2_000;

const CONTEXT_DEV_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The longest a provider-chosen `Retry-After` may park this run.
 *
 * The request timeout does not bound this wait, because the wait sits BETWEEN
 * requests. A 429 answering `Retry-After: 3600` is an ordinary shape for a rate
 * limited API, and honouring it verbatim would park a scheduled refresh for an
 * hour per retry. Past this ceiling the answer is that we are rate limited,
 * which the next scheduled run can act on, rather than a job that hangs.
 */
export const CONTEXT_DEV_MAX_RETRY_AFTER_MS = 30_000;

/**
 * Requests ONE run may send, counting retries, so a retry storm spends the run
 * rather than the account - the ceiling lib/harvest/firecrawl.ts puts on its own
 * lane, for the same reason. A request is the unit here because the endpoints do
 * not cost the same: a markdown scrape, a URL map read and a crawled page are 1
 * credit each, a search is 1 per 10 results, and a JSON scrape costs up to 5.
 * Keep the request ceiling even if provider credit prices change.
 */
export const CONTEXT_DEV_RUN_REQUEST_BUDGET = 12;

/** Most URLs one batch submission may carry, from the published catalog. */
export const CONTEXT_DEV_BATCH_MAX_URLS = 25_000;

export type ContextDevBudget = {
  /** Requests this run may send in total. */
  readonly limit: number;
  spent(): number;
  remaining(): number;
  /**
   * Reserve one request. Returns false when the run's cap is reached, in which
   * case the caller must NOT send anything.
   */
  take(): boolean;
};

export function createContextDevBudget(limit: number = CONTEXT_DEV_RUN_REQUEST_BUDGET): ContextDevBudget {
  const ceiling = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  let spent = 0;
  return {
    limit: ceiling,
    spent: () => spent,
    remaining: () => Math.max(0, ceiling - spent),
    take: () => {
      if (spent >= ceiling) return false;
      spent += 1;
      return true;
    },
  };
}

export type ContextDevFailure = {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
};

type ContextDevNotConfigured = { status: "not-configured" };

type ContextDevError = { status: "error"; error: ContextDevFailure };

type ContextDevScrapeOk = {
  status: "ok";
  url: string;
  markdown: string;
};

export type ContextDevScrapeResult = ContextDevNotConfigured | ContextDevScrapeOk | ContextDevError;

type ContextDevHtmlOk = {
  status: "ok";
  url: string;
  html: string;
};

export type ContextDevHtmlResult = ContextDevNotConfigured | ContextDevHtmlOk | ContextDevError;

type ContextDevSitemapOk = {
  status: "ok";
  domain: string;
  urls: string[];
};

export type ContextDevSitemapResult = ContextDevNotConfigured | ContextDevSitemapOk | ContextDevError;

type ContextDevCrawlPage = {
  url: string;
  markdown: string;
};

type ContextDevCrawlOk = {
  status: "ok";
  url: string;
  pages: ContextDevCrawlPage[];
};

export type ContextDevCrawlResult = ContextDevNotConfigured | ContextDevCrawlOk | ContextDevError;

type ContextDevSearchHit = {
  url: string;
  title: string;
  description: string;
  markdown: string | null;
};

type ContextDevSearchOk = {
  status: "ok";
  query: string;
  results: ContextDevSearchHit[];
};

export type ContextDevSearchResult = ContextDevNotConfigured | ContextDevSearchOk | ContextDevError;

type ContextDevBrandOk = {
  status: "ok";
  domain: string;
  brand: Record<string, unknown> | null;
};

export type ContextDevBrandResult = ContextDevNotConfigured | ContextDevBrandOk | ContextDevError;

type ContextDevBatchOk = {
  status: "ok";
  batchId: string;
  submitted: number;
  invalidUrls: number;
};

export type ContextDevBatchResult = ContextDevNotConfigured | ContextDevBatchOk | ContextDevError;

type ContextDevExtractOk<T> = {
  status: "ok";
  url: string;
  data: T;
  markdown: string;
  urlsAnalyzed: string[];
};

export type ContextDevExtractResult<T = Record<string, unknown>> =
  | ContextDevNotConfigured
  | ContextDevExtractOk<T>
  | ContextDevError;

export type ContextDevCallOptions = {
  /**
   * How old a cached answer may be before Context.dev refetches the page. Pass
   * it whenever freshness is part of the claim the answer will carry; 0 forces a
   * live read. `extract` overrides this option; see its wrapper contract.
   */
  maxAgeMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Shared per-run request ceiling. Absent means this call is uncapped. */
  budget?: ContextDevBudget;
  /**
   * The live robots check for a host this repository has not already recorded a
   * permission for. Required for such a host: without it the call is refused
   * unread, because a fetch layer may not stand in for a permission.
   */
  robots?: RobotsChecker;
};

export function contextDevApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.CONTEXT_DEV_API_KEY?.trim();
  return key ? key : null;
}

export function isContextDevConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return contextDevApiKey(env) !== null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds * 1000);
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function failureFromApiError(error: APIError): ContextDevFailure {
  const status = typeof error.status === "number" ? error.status : undefined;
  const envelope = error.error as { error?: unknown; error_code?: unknown; message?: unknown } | undefined;
  const message =
    (typeof envelope?.error === "string" && envelope.error) ||
    (typeof envelope?.message === "string" && envelope.message) ||
    (status === undefined ? error.message : `Context.dev returned ${status}.`);
  const code =
    (typeof envelope?.error_code === "string" && envelope.error_code) ||
    (status === undefined
      ? "NETWORK"
      : status === 429
        ? "RATE_LIMITED"
        : status >= 500
          ? "PROVIDER_UNAVAILABLE"
          : "INVALID_REQUEST");
  return {
    code,
    message,
    // A status we could not read is a transport fault, which is retryable for
    // the same reason a 5xx is: it says nothing about the request.
    retryable: status === undefined ? true : isRetryableStatus(status),
    ...(status === undefined ? {} : { statusCode: status }),
  };
}

type AttemptOk<T> = { kind: "value"; value: T };
type AttemptFail = {
  kind: "fail";
  failure: ContextDevFailure;
  retry: boolean;
  retryAfter?: string | null;
};
type Attempt<T> = AttemptOk<T> | AttemptFail;

async function withRetries<T>(
  attemptOnce: () => Promise<Attempt<T>>,
  options: ContextDevCallOptions,
): Promise<T | ContextDevError> {
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? CONTEXT_DEV_MAX_ATTEMPTS);
  const budget = options.budget;
  let last: ContextDevFailure | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (budget && !budget.take()) {
      const spent = `Run budget of ${budget.limit} Context.dev requests is spent.`;
      // A ceiling reached BEFORE anything was sent is the whole finding. A
      // ceiling reached between retries is not: the upstream failure that
      // caused the retry is the actionable one, so it stays the answer and the
      // budget rides along as the reason no further attempt was made.
      if (last) {
        return {
          status: "error",
          error: { ...last, message: `${last.message} ${spent} No further attempt was made.` },
        };
      }
      return {
        status: "error",
        error: { code: "BUDGET_EXHAUSTED", message: spent, retryable: false },
      };
    }
    const result = await attemptOnce();
    if (result.kind === "value") {
      return result.value;
    }
    last = result.failure;
    if (!result.retry || attempt === maxAttempts) break;
    const retryAfter =
      result.failure.statusCode === 429 ? parseRetryAfterMs(result.retryAfter ?? null) : null;
    if (retryAfter !== null && retryAfter > CONTEXT_DEV_MAX_RETRY_AFTER_MS) {
      last = {
        ...result.failure,
        retryable: false,
        message:
          `${result.failure.message} Retry-After asks for ${Math.ceil(retryAfter / 1000)}s, ` +
          `past the ${Math.round(CONTEXT_DEV_MAX_RETRY_AFTER_MS / 1000)}s ceiling, so this run ` +
          "stopped instead of waiting.",
      };
      break;
    }
    await sleepImpl(retryAfter ?? CONTEXT_DEV_RETRY_BASE_DELAY_MS * attempt);
  }

  return {
    status: "error",
    error: last ?? {
      code: "PROVIDER_UNAVAILABLE",
      message: "Context.dev request failed.",
      retryable: false,
    },
  };
}

function contextDevClient(apiKey: string, options: ContextDevCallOptions): ContextDev {
  return new ContextDev({
    apiKey,
    baseURL: CONTEXT_DEV_API_BASE,
    timeout: options.timeoutMs ?? CONTEXT_DEV_REQUEST_TIMEOUT_MS,
    // OUR retry policy is the only one. The SDK's own retries would spend
    // budget this module never counted and would wait on a schedule that
    // ignores the Retry-After ceiling above.
    maxRetries: 0,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
}

/**
 * Send one SDK call and classify its outcome the way `withRetries` expects.
 *
 * `emptyBody` is what a 2xx that carried nothing useful is called. It is never
 * retried: the page answered, and asking it the same question again does not
 * change what it states.
 */
async function attempt<Raw, Value>(
  send: () => Promise<Raw>,
  read: (raw: Raw) => Value | null,
  emptyBody: string,
): Promise<Attempt<Value>> {
  try {
    const raw = await send();
    const value = raw == null ? null : read(raw);
    if (value === null) {
      return {
        kind: "fail",
        failure: { code: "EMPTY_BODY", message: emptyBody, retryable: false },
        retry: false,
      };
    }
    return { kind: "value", value };
  } catch (error) {
    if (error instanceof APIError) {
      const failure = failureFromApiError(error);
      return {
        kind: "fail",
        failure,
        retry: failure.retryable,
        retryAfter: error.headers?.get("retry-after") ?? null,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      kind: "fail",
      failure: { code: aborted ? "TIMEOUT" : "NETWORK", message, retryable: true },
      retry: true,
    };
  }
}

/**
 * Why a URL may not be read, or null when it may.
 *
 * PURE and network-free, so a refusal costs nothing. This is the half of the
 * gate that can never be turned off: a host `lib/harvest/sourcePolicy.ts`
 * refuses is refused here whatever else a caller passes.
 */
export function contextDevUrlRefusal(url: string, options: ContextDevCallOptions = {}): ContextDevFailure | null {
  if (!isHarvestableOperatorUrl(url)) {
    return {
      code: "SOURCE_REFUSED",
      message:
        `lib/harvest/sourcePolicy.ts refuses ${url}. Context.dev is a fetch layer, ` +
        "never a permission, so nothing was sent.",
      retryable: false,
    };
  }
  if (!hasRecordedHarvestPermission(url) && !options.robots) {
    return {
      code: "ROBOTS_UNCHECKED",
      message:
        `No recorded permission covers ${url} and no live robots check was supplied, ` +
        "so nothing was sent. Pass `robots: createRobotsChecker()`.",
      retryable: false,
    };
  }
  return null;
}

/**
 * Run the whole gate for one URL: the pure refusal above, then the live robots
 * answer when the caller brought one.
 *
 * Both halves run BEFORE a credit is spent, and a host we could not read a
 * rules file for is a refusal rather than a silent yes - the rule
 * `lib/harvest/robots.ts` already owns, asked here rather than restated.
 */
async function gate(url: string, options: ContextDevCallOptions): Promise<ContextDevError | null> {
  const refusal = contextDevUrlRefusal(url, options);
  if (refusal) return { status: "error", error: refusal };
  if (!options.robots) return null;
  const decision = await options.robots(url);
  if (decision.allowed) return null;
  return {
    status: "error",
    error: {
      code: "ROBOTS_REFUSED",
      message: `${decision.reason}: ${decision.evidence}`,
      retryable: false,
    },
  };
}

/** The shape every URL-taking call shares: key, gate, then the retried send. */
async function guardedCall<T>(
  url: string,
  options: ContextDevCallOptions,
  run: (client: ContextDev) => Promise<Attempt<T>>,
): Promise<ContextDevNotConfigured | ContextDevError | T> {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" };
  const refused = await gate(url, options);
  if (refused) return refused;
  const client = contextDevClient(apiKey, options);
  return withRetries(() => run(client), options);
}

function positiveMaxAge(options: ContextDevCallOptions): number | undefined {
  return options.maxAgeMs === undefined ? undefined : Math.max(0, options.maxAgeMs);
}

/** Scrape one page to Markdown. 1 credit. */
export async function scrapeMarkdown(
  url: string,
  options: ContextDevCallOptions = {},
): Promise<ContextDevScrapeResult> {
  return guardedCall<ContextDevScrapeOk>(url, options, (client) =>
    attempt(
      () => client.web.scrape({ url, formats: { markdown: true }, maxAgeMs: positiveMaxAge(options) }),
      (body) =>
        body.markdown?.success === true && typeof body.markdown.data === "string"
          ? { status: "ok" as const, url: typeof body.url === "string" && body.url ? body.url : url, markdown: body.markdown.data }
          : null,
      "Scrape returned no markdown.",
    ),
  );
}

/** Read the account before an authorized harvest. This endpoint costs no credits. */
export async function contextDevUsage(options: ContextDevCallOptions = {}) {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" as const };
  const client = contextDevClient(apiKey, options);
  return withRetries(() => attempt(
    () => client.get<{ credits_remaining: number; next_refill: unknown }>("/org/usage", {}),
    (body) => Number.isInteger(body.credits_remaining) && body.credits_remaining >= 0
      ? { status: "ok" as const, creditsRemaining: body.credits_remaining, nextRefill: body.next_refill }
      : null,
    "Usage returned no credit balance.",
  ), options);
}

/** The allowance is read before allocating this harvest's monitors. */
export async function contextDevMonitorLimits(options: ContextDevCallOptions = {}) {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" as const };
  const client = contextDevClient(apiKey, options);
  return withRetries(() => attempt(
    () => client.monitors.getLimits(),
    (body) => Number.isInteger(body.monitors_limit) && Number.isInteger(body.monitors_used)
      ? { status: "ok" as const, limit: body.monitors_limit, used: body.monitors_used }
      : null,
    "Monitor limits returned no allowance.",
  ), options);
}

/** A weekly exact-text monitor. Its baseline and each scheduled check cost one credit. */
export async function createPageMonitor(url: string, name: string, options: ContextDevCallOptions = {}) {
  return guardedCall(url, options, (client) => attempt(
    () => client.monitors.create({ name, target: { type: "page", url }, change_detection: { type: "exact" }, schedule: { type: "interval", frequency: 7, unit: "days" } }),
    (body) => body.id ? { status: "ok" as const, id: body.id, initialRunId: body.initial_run_id } : null,
    "Monitor returned no id.",
  ));
}

/** Poll one owned monitor's changes. Polling costs no credits. */
async function pageMonitorChanges(url: string, id: string, options: ContextDevCallOptions = {}) {
  return guardedCall(url, options, (client) => attempt(
    () => client.monitors.listChanges(id, { limit: 100 }),
    (body) => Array.isArray(body.data) ? { status: "ok" as const, changes: body.data, hasMore: body.has_more } : null,
    "Monitor returned no changes list.",
  ));
}

/** Read an owned monitor's baseline outcome before starting another capture. */
export async function pageMonitorRun(url: string, id: string, runId: string, options: ContextDevCallOptions = {}) {
  return guardedCall(url, options, (client) => attempt(
    () => client.monitors.retrieveRun(runId, { monitor_id: id }),
    (body) => body.id ? { status: "ok" as const, runStatus: body.status, creditsCharged: body.credits_charged, error: body.error } : null,
    "Monitor returned no run outcome.",
  ));
}

/** Only a new provider change permits another fresh read. An unchanged page keeps its observation date. */
export async function refreshChangedPage(url: string, id: string, seenChanges: readonly string[], options: ContextDevCallOptions = {}) {
  const changes = await pageMonitorChanges(url, id, { ...options, budget: undefined });
  if (changes.status !== "ok") return changes;
  const unseen = changes.changes.filter((change) => !seenChanges.includes(change.id));
  if (!unseen.length) return { status: "unchanged" as const };
  if (unseen.some((change) => change.url !== url)) return {
    status: "error" as const,
    error: { code: "MONITOR_TARGET_MISMATCH", message: "Monitor change does not name the watched page.", retryable: false },
  };
  const page = await scrapeMarkdown(url, { ...options, maxAgeMs: 0 });
  if (page.status !== "ok") return page;
  return { ...page, observedAt: new Date().toISOString(), changeIds: unseen.map((change) => change.id) };
}

/** Scrape one page to HTML. 1 credit. */
export async function scrapeHtml(
  url: string,
  options: ContextDevCallOptions = {},
): Promise<ContextDevHtmlResult> {
  return guardedCall<ContextDevHtmlOk>(url, options, (client) =>
    attempt(
      () => client.web.scrape({ url, formats: { html: true }, maxAgeMs: positiveMaxAge(options) }),
      (body) =>
        body.html?.success === true && typeof body.html.data === "string"
          ? { status: "ok" as const, url: typeof body.url === "string" && body.url ? body.url : url, html: body.html.data }
          : null,
      "Scrape returned no html.",
    ),
  );
}

/**
 * The URLs a domain's own sitemap names. 1 credit.
 *
 * Takes a URL rather than a bare domain so the gate above can be asked the same
 * question it is asked everywhere else; the domain handed to the API is that
 * URL's host.
 */
export async function sitemapUrls(
  url: string,
  options: ContextDevCallOptions & { maxLinks?: number; urlRegex?: string } = {},
): Promise<ContextDevSitemapResult> {
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return {
      status: "error",
      error: { code: "SOURCE_REFUSED", message: `${url} is not a URL.`, retryable: false },
    };
  }
  return guardedCall<ContextDevSitemapOk>(url, options, (client) =>
    attempt(
      () =>
        client.web.mapUrls({
          domain,
          ...(options.maxLinks === undefined ? {} : { maxLinks: options.maxLinks }),
          ...(options.urlRegex === undefined ? {} : { urlRegex: options.urlRegex }),
        }),
      (body) =>
        Array.isArray(body?.urls)
          ? {
              status: "ok" as const,
              domain: typeof body.domain === "string" && body.domain ? body.domain : domain,
              urls: body.urls.map((entry) => entry?.url).filter((entry): entry is string => typeof entry === "string"),
            }
          : null,
      "Sitemap read returned no urls.",
    ),
  );
}

/**
 * Crawl a site to Markdown, one page per credit.
 *
 * PERMISSION HERE IS A HOST-LEVEL QUESTION, and that is a weaker promise than
 * the one the other calls make. The gate asks about the START url, but a crawl
 * WANDERS: `lib/harvest/robots.ts` answers per PATH, so a crawl that begins on
 * a permitted page can still reach a path that host's own rules disallow, and
 * nothing here re-asks on the way. Point this only at a host whose permission
 * covers the whole site, and prefer `sitemapUrls` plus a gated `scrapeMarkdown`
 * per page where a page-level answer is what you actually need. No lane in this
 * repository uses it today; it exists so one can, deliberately.
 */
export async function crawlMarkdown(
  url: string,
  options: ContextDevCallOptions & { maxPages?: number; maxDepth?: number; urlRegex?: string } = {},
): Promise<ContextDevCrawlResult> {
  return guardedCall<ContextDevCrawlOk>(url, options, (client) =>
    attempt(
      () =>
        client.web.webCrawlMd({
          url,
          maxAgeMs: positiveMaxAge(options),
          ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
          ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
          ...(options.urlRegex === undefined ? {} : { urlRegex: options.urlRegex }),
        }),
      (body) =>
        Array.isArray(body?.results)
          ? {
              status: "ok" as const,
              url,
              pages: body.results.map((page) => ({
                url: page?.metadata?.finalUrl ?? page?.metadata?.sourceUrl ?? url,
                markdown: typeof page?.markdown === "string" ? page.markdown : "",
              })),
            }
          : null,
      "Crawl returned no pages.",
    ),
  );
}

/**
 * Extract one page into a JSON schema through the unified scrape.
 *
 * Freshness, capture completeness and credit costs are defined in
 * docs/rules/lib-shared-seams-stores-http-freshness-brand.md, Context.dev contract.
 */
export async function extract<T extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  schema: Record<string, unknown>,
  options: ContextDevCallOptions & { instructions?: string } = {},
): Promise<ContextDevExtractResult<T>> {
  const instructions =
    typeof options.instructions === "string" && options.instructions.trim().length > 0
      ? options.instructions.trim()
      : undefined;
  return guardedCall<ContextDevExtractOk<T>>(url, options, (client) =>
    attempt(
      () =>
        client.web.scrape({
          url,
          formats: { json: true, markdown: true },
          jsonParams: { schema, ...(instructions === undefined ? {} : { instructions }) },
          maxAgeMs: 0,
        }),
      (body) =>
        body?.isPartial !== true && body?.json?.success === true && typeof body.json.data === "object" && body.json.data !== null
          && body.markdown?.success === true && typeof body.markdown.data === "string"
          && typeof body.url === "string" && body.url.length > 0
          ? {
              status: "ok" as const,
              url: body.url,
              data: body.json.data as T,
              markdown: body.markdown.data,
              urlsAnalyzed: [body.url],
            }
          : null,
      "Extract returned no data.",
    ),
  );
}

/**
 * Search the web. 1 credit per 10 results.
 *
 * A search has no URL to gate, so the gate is applied to what comes BACK: every
 * hit whose host `lib/harvest/sourcePolicy.ts` refuses is dropped before the
 * caller sees it, and a hit is never fetched from here.
 */
export async function searchWeb(
  query: string,
  options: ContextDevCallOptions & { numResults?: number; includeDomains?: string[]; excludeDomains?: string[] } = {},
): Promise<ContextDevSearchResult> {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" };
  const client = contextDevClient(apiKey, options);
  return withRetries<ContextDevSearchOk>(
    () =>
      attempt(
        () =>
          client.web.search({
            query,
            ...(options.numResults === undefined ? {} : { numResults: options.numResults }),
            ...(options.includeDomains === undefined ? {} : { includeDomains: options.includeDomains }),
            ...(options.excludeDomains === undefined ? {} : { excludeDomains: options.excludeDomains }),
          }),
        (body) =>
          Array.isArray(body?.results)
            ? {
                status: "ok" as const,
                query: typeof body.query === "string" ? body.query : query,
                results: body.results
                  .filter((hit) => isHarvestableOperatorUrl(hit?.url))
                  .map((hit) => ({
                    url: hit.url,
                    title: typeof hit.title === "string" ? hit.title : "",
                    description: typeof hit.description === "string" ? hit.description : "",
                    markdown: typeof hit.markdown?.markdown === "string" ? hit.markdown.markdown : null,
                  })),
              }
            : null,
        "Search returned no results field.",
      ),
    options,
  );
}

/** Everything the brand record holds for one domain. 10 credits. */
export async function brandRetrieve(
  url: string,
  options: ContextDevCallOptions = {},
): Promise<ContextDevBrandResult> {
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return {
      status: "error",
      error: { code: "SOURCE_REFUSED", message: `${url} is not a URL.`, retryable: false },
    };
  }
  return guardedCall<ContextDevBrandOk>(url, options, (client) =>
    attempt(
      () =>
        client.brand.retrieve({
          type: "by_domain",
          domain,
          ...(positiveMaxAge(options) === undefined ? {} : { maxAgeMs: positiveMaxAge(options) as number }),
        }),
      (body) =>
        body
          ? {
              status: "ok" as const,
              domain,
              brand: (body.brand as Record<string, unknown> | undefined) ?? null,
            }
          : null,
      "Brand read returned no body.",
    ),
  );
}

/**
 * Queue up to CONTEXT_DEV_BATCH_MAX_URLS pages for asynchronous scraping.
 *
 * EVERY url is gated first and the whole submission is refused when one of them
 * is: a batch is one job, so dropping the refused pages quietly would leave the
 * caller believing it submitted the list it handed in.
 */
export async function batchSubmit(
  urls: readonly string[],
  options: ContextDevCallOptions & { webhookUrl?: string; tags?: string[] } = {},
): Promise<ContextDevBatchResult> {
  const apiKey = contextDevApiKey(options.env ?? process.env);
  if (!apiKey) return { status: "not-configured" };
  if (urls.length === 0 || urls.length > CONTEXT_DEV_BATCH_MAX_URLS) {
    return {
      status: "error",
      error: {
        code: "INVALID_REQUEST",
        message: `A batch carries 1 to ${CONTEXT_DEV_BATCH_MAX_URLS} urls; this one carried ${urls.length}.`,
        retryable: false,
      },
    };
  }
  for (const url of urls) {
    const refusal = contextDevUrlRefusal(url, options);
    if (refusal) return { status: "error", error: refusal };
  }
  if (options.robots) {
    for (const url of urls) {
      const decision = await options.robots(url);
      if (!decision.allowed) {
        return {
          status: "error",
          error: {
            code: "ROBOTS_REFUSED",
            message: `${decision.reason}: ${decision.evidence}`,
            retryable: false,
          },
        };
      }
    }
  }
  const client = contextDevClient(apiKey, options);
  return withRetries<ContextDevBatchOk>(
    () =>
      attempt(
        () =>
          client.batch.submit({
            input: {
              mode: "scrape",
              data: { format: "markdown", urls: urls.map((url) => ({ url })) },
            },
            ...(options.webhookUrl === undefined ? {} : { webhookUrl: options.webhookUrl }),
            ...(options.tags === undefined ? {} : { tags: options.tags }),
          }),
        (body) =>
          typeof body?.id === "string"
            ? {
                status: "ok" as const,
                batchId: body.id,
                submitted: urls.length - (Array.isArray(body.invalid_urls) ? body.invalid_urls.length : 0),
                invalidUrls: Array.isArray(body.invalid_urls) ? body.invalid_urls.length : 0,
              }
            : null,
        "Batch submission returned no id.",
      ),
    options,
  );
}
