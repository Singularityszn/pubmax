import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// The one Claude API client. Typed Pub Pal chat (lib/palClaudeChat.server.ts),
// map Ask (lib/ask/modelLoop.ts) and every JSON read (lib/claudeJson.server.ts:
// the bill check, the board reader, the pub list import and the avatar check)
// pay from the same Claude Platform key, so the key, the host, the default
// model, and the prompt cache markers live here once.
//
// The host is named here so /privacy can be held to it (__tests__/legalPages.test.ts).
const CLAUDE_API_HOST = "api.anthropic.com";

/** A fast, low-cost model for every Claude call. */
export const CLAUDE_DEFAULT_MODEL = "claude-haiku-5-5";

type Env = Record<string, string | undefined>;

/** The Claude Platform key, or null when this deploy has none. */
export function claudeApiKey(env: Env = process.env): string | null {
  return env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Whether this deploy can call Claude at all. */
export function claudeConfigured(env: Env = process.env): boolean {
  return claudeApiKey(env) !== null;
}

/** The model every Claude call uses. `PUB_PAL_CLAUDE_MODEL` overrides it. */
export function claudeModel(env: Env = process.env): string {
  return env.PUB_PAL_CLAUDE_MODEL?.trim() || CLAUDE_DEFAULT_MODEL;
}

type ClaudeStream = {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
};

/** The one SDK call a chat turn makes, so a test can pass a fake. */
export type ClaudeClient = {
  stream(body: Anthropic.MessageStreamParams, options: { signal: AbortSignal }): ClaudeStream;
};

/** The one SDK call a JSON read makes. */
export type ClaudeJsonClient = {
  create(body: Anthropic.MessageCreateParamsNonStreaming, options: { signal: AbortSignal }): Promise<Anthropic.Message>;
};

/** The SDK client for a key. Building one is cheap and holds no connection. */
export function claudeClient(apiKey: string): ClaudeClient {
  // One retry: chat turns run under short deadlines, and the callers have
  // their own fallbacks (a 503 the client retries, or the deterministic Ask tools).
  const sdk = new Anthropic({ apiKey, baseURL: `https://${CLAUDE_API_HOST}`, maxRetries: 1 });
  return { stream: (body, options) => sdk.messages.stream(body, options) };
}

/**
 * The non-streaming SDK client for a key, for one JSON answer. No retry: each
 * caller already fails soft (an `unchecked` price, a retry line, a line-by-line
 * match). The JSON lane traces each read itself with a fixed route tag, so the
 * SDK's own spans are off. `fetcher` lets a test answer on the real wire.
 */
export function claudeJsonClient(apiKey: string, fetcher?: typeof fetch): ClaudeJsonClient {
  const sdk = new Anthropic({
    apiKey,
    baseURL: `https://${CLAUDE_API_HOST}`,
    maxRetries: 0,
    openTelemetry: false,
    ...(fetcher ? { fetch: fetcher } : {}),
  });
  return { create: (body, options) => sdk.messages.create(body, options) };
}

/**
 * A system prompt with a cache breakpoint on it. Tools render before the
 * system prompt, so this one marker caches the tools and the prompt together
 * for every caller of a surface, whatever the conversation after it holds.
 * Pair it with top-level `cache_control` so later rounds of one turn also
 * read the growing message tail from the cache.
 */
export function claudeCachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/** Every input token the call was billed for, cached or not, for the trace's prompt count. */
export function claudePromptTokens(usage: Anthropic.Usage): number {
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}
