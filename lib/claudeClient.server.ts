import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { log } from "@/lib/log";

// The one Claude API client for user chat: typed Pub Pal chat
// (lib/palClaudeChat.server.ts) and map Ask (lib/ask/modelLoop.ts). Both pay
// from the same Claude Platform key, so the key, the host, the default model,
// the prompt cache markers and the usage line live here once.
//
// The host is named here so /privacy can be held to it (__tests__/legalPages.test.ts).
const CLAUDE_API_HOST = "api.anthropic.com";

/** A fast, low-cost model for chat answers. Each surface reads its own override env. */
export const CLAUDE_CHAT_DEFAULT_MODEL = "claude-haiku-5-5";

/** The Claude Platform key, or null when this deploy has none. */
export function claudeApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

/** Whether this deploy sends user chat to Claude. */
export function claudeConfigured(): boolean {
  return claudeApiKey() !== null;
}

/** The model a surface uses: its override env when set, else the default. */
export function claudeChatModel(overrideEnv: string): string {
  return process.env[overrideEnv]?.trim() || CLAUDE_CHAT_DEFAULT_MODEL;
}

type ClaudeStream = {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
};

/** The one SDK call a chat turn makes, so a test can pass a fake. */
export type ClaudeClient = {
  stream(body: Anthropic.MessageStreamParams, options: { signal: AbortSignal }): ClaudeStream;
};

/** The SDK client for a key. Building one is cheap and holds no connection. */
export function claudeClient(apiKey: string): ClaudeClient {
  // One retry: chat turns run under short deadlines, and the callers have
  // their own fallbacks (a 503 the client retries, or the deterministic Ask tools).
  const anthropic = new Anthropic({ apiKey, baseURL: `https://${CLAUDE_API_HOST}`, maxRetries: 1 });
  return { stream: (body, options) => anthropic.messages.stream(body, options) };
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

/**
 * One structured line per model call: the route, the model and the token
 * counts by billing class. It carries no prompt, reply, caller or key. Field
 * names avoid the word "token", which the logger redacts as a secret name.
 */
export function logClaudeUsage(route: string, model: string, usage: Anthropic.Usage): void {
  log("info", "claude.usage", {
    route,
    model,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  });
}
