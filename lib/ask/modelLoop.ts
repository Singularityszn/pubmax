// Model tool-calling loop for Night OS Ask. Allowlisted tools only; capped
// rounds. Claude answers when the deploy has a Claude Platform key
// (lib/claudeClient.server.ts, the client typed Pub Pal chat shares), and
// OpenRouter answers otherwise, exactly as before. Falls back to null so the
// deterministic path can answer when the model is missing or fails.

import type Anthropic from "@anthropic-ai/sdk";

import {
  askToolDefinitions,
  runAskTool,
  type AskToolContext,
  type AskToolResult,
} from "@/lib/ask/tools";
import { isAskToolName, type AskTurn } from "@/lib/ask/types";
import {
  claudeApiKey,
  claudeCachedSystem,
  claudeChatModel,
  claudeClient,
  claudeConfigured,
  claudePromptTokens,
  logClaudeUsage,
  type ClaudeClient,
} from "@/lib/claudeClient.server";
import { traceArizeModelLoop, type ArizeModelLoopSpans } from "@/lib/observability/arize";

/**
 * The one host Ask sends prompt text to, named here so `/privacy` can be held
 * to it (`__tests__/legalPages.test.ts`). `OPENROUTER_BASE_URL` overrides it so
 * a test can point the loop at a local mock model server
 * (`__tests__/askModelLoopMock.test.ts`); /privacy names this default, so a
 * deployment pointed elsewhere is a change to that page too.
 */
const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_ROUNDS = 3;
const MAX_TOKENS = 500;
/** Tool calls one model round may run. */
const MAX_TOOLS_PER_ROUND = 3;
const TIMEOUT_MS = 12_000;
/** The OpenRouter model, used only when the deploy has no Claude key. */
export const DEFAULT_ASK_MODEL = "anthropic/claude-sonnet-4-5";
/** Claude model override for Ask; the shared default otherwise. */
const ASK_CLAUDE_MODEL_ENV = "ASK_CLAUDE_MODEL";
// Claude thinks before it calls a tool, and thinking counts toward this cap,
// so it leaves room above the tool call itself.
const CLAUDE_MAX_TOKENS = 1_024;
// Ask's model only chooses tools; low effort keeps that quick and cheap.
const CLAUDE_EFFORT = "low" as const;

/** Whether this deploy has a model for Ask: Claude, or OpenRouter as the fallback. */
export function askModelConfigured(): boolean {
  return claudeConfigured() || Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function openRouterChatCompletionsUrl(): string {
  const base = process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_API_BASE_URL;
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

export type ModelAskOutcome = {
  toolResults: AskToolResult[];
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function systemPrompt(): string {
  return [
    "You are the Night OS Ask assistant for PUBMAXX, a London pub night planner.",
    "Use ONLY the provided tools. Never invent pubs, prices, listings, or transit facts.",
    "If a tool returns nothing, say so plainly. Prefer short British English.",
    "For map moves or plans, call propose_map_action or propose_plan - the user must confirm.",
    "Do not claim a community price moves the map unless the tool says it is corroborated.",
  ].join(" ");
}

type AskModelResponseBody = {
  choices?: Array<{
    message?: ChatMessage;
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
};

function askModelMessages(query: string, turns: AskTurn[] = []): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt() }];
  for (const turn of turns) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content.slice(0, 800) });
    }
  }
  messages.push({ role: "user", content: query.slice(0, 500) });
  return messages;
}

function askModelRequest(input: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      tools: askToolDefinitions(),
      tool_choice: "auto",
      messages: input.messages,
      usage: { include: true },
    }),
    signal: input.signal,
  };
}

export type ProbeAskModelToolChoiceResult = {
  /** Names of the first three tool calls as the model sent them, in call order (not allowlist-filtered). */
  tools: string[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
  httpStatus?: number;
  /** Transport failure (HTTP error, timeout, network). A reply with no tool calls is not an error. */
  error?: string;
};

/**
 * The first-round OpenRouter request `runAskModelLoop` sends for a fresh query,
 * returning tool names only (no tool execution). For offline router evals.
 */
export async function probeAskModelToolChoice(input: {
  query: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<ProbeAskModelToolChoiceResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = performance.now();
  const empty = (): ProbeAskModelToolChoiceResult => ({
    tools: [],
    latencyMs: performance.now() - started,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: null,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      openRouterChatCompletionsUrl(),
      askModelRequest({
        apiKey: input.apiKey,
        model: input.model,
        messages: askModelMessages(input.query),
        signal: controller.signal,
      }),
    );
    const latencyMs = performance.now() - started;
    if (!response.ok) {
      return {
        ...empty(),
        latencyMs,
        httpStatus: response.status,
        error: `OpenRouter responded ${response.status}.`,
      };
    }
    const body = (await response.json()) as AskModelResponseBody;
    const tools = (body.choices?.[0]?.message?.tool_calls ?? [])
      .slice(0, 3)
      .map((call) => call.function?.name ?? "");
    const cost = body.usage?.cost;
    return {
      tools,
      latencyMs,
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
      costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    };
  } catch (error) {
    return {
      ...empty(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The call's arguments as an object, or null when they are not a JSON object. */
function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* rejected below */
  }
  return null;
}

type AskToolHandlers = {
  toolCall: ArizeModelLoopSpans["toolCall"];
  ctx: AskToolContext;
  toolResults: AskToolResult[];
};

/**
 * Runs one model tool call and returns the reply the model reads, as JSON
 * text. The same reply goes back on either provider. A name off the allowlist
 * or arguments that are not an object get an error reply and run nothing.
 * A tool failure rethrows: the tool span records it and the loop ends.
 */
async function askToolReply(
  name: string,
  args: Record<string, unknown> | null,
  handlers: AskToolHandlers,
): Promise<string> {
  if (!isAskToolName(name)) return JSON.stringify({ error: "Tool not allowlisted." });
  if (!args) return JSON.stringify({ error: "Tool arguments were not a JSON object." });
  const toolSpan = handlers.toolCall({ name, input: args });
  let result: AskToolResult;
  try {
    result = await runAskTool(name, args, {
      ...handlers.ctx,
      skipModel: true,
    });
  } catch (error) {
    toolSpan?.setError(error);
    toolSpan?.end();
    throw error;
  }
  toolSpan?.setOutput(
    JSON.stringify({
      ok: result.ok,
      answerHint: result.answerHint,
    }),
  );
  toolSpan?.end();
  handlers.toolResults.push(result);
  return JSON.stringify({
    ok: result.ok,
    answerHint: result.answerHint,
    cardCount: result.cards.length,
    proposalCount: result.proposals.length,
    degraded: result.degraded === true,
    data: result.data,
  }).slice(0, 6000);
}

/**
 * Runs one OpenRouter round's tool calls (capped by the caller) and appends
 * each result to the running messages, so the loop body stays readable.
 */
async function runAskLoopTools(
  calls: NonNullable<ChatMessage["tool_calls"]>,
  handlers: AskToolHandlers & { messages: ChatMessage[] },
): Promise<void> {
  for (const call of calls) {
    const name = call.function?.name ?? "";
    const args = isAskToolName(name) ? parseArgs(call.function.arguments) : null;
    handlers.messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: await askToolReply(name, args, handlers),
    });
  }
}

/** Ask's tools in the Claude API's shape, built from the one tool registry. */
function askClaudeTools(): Anthropic.Tool[] {
  return askToolDefinitions().map(({ function: definition }) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters as Anthropic.Tool.InputSchema,
  }));
}

/** The conversation as Claude reads it. The first message must be the user's. */
function askClaudeMessages(query: string, turns: AskTurn[] = []): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of turns) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    if (messages.length === 0 && turn.role !== "user") continue;
    messages.push({ role: turn.role, content: turn.content.slice(0, 800) });
  }
  messages.push({ role: "user", content: query.slice(0, 500) });
  return messages;
}

/**
 * The Claude half of `runAskModelLoop`: the same rounds, tool cap, deadline,
 * allowlist and outcome as the OpenRouter half, on the shared Claude client.
 */
async function runAskClaudeLoop(input: {
  query: string;
  turns?: AskTurn[];
  ctx: AskToolContext;
  client: ClaudeClient;
  model: string;
  timeoutMs?: number;
  traceRoute: string;
}): Promise<ModelAskOutcome | null> {
  const messages = askClaudeMessages(input.query, input.turns);
  const tools = askClaudeTools();

  return traceArizeModelLoop({
    route: input.traceRoute,
    model: input.model,
    provider: "anthropic",
    prompt: input.query,
    invocationParameters: { max_tokens: CLAUDE_MAX_TOKENS, effort: CLAUDE_EFFORT },
    run: async ({ modelRound, toolCall, setError }) => {
      const toolResults: AskToolResult[] = [];
      let tracedMessageCount = 0;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? TIMEOUT_MS);

      try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const roundSpan = modelRound({
            prompt: JSON.stringify(messages.slice(tracedMessageCount)),
          });
          tracedMessageCount = messages.length;
          let message: Anthropic.Message;
          try {
            message = await input.client
              .stream(
                {
                  model: input.model,
                  max_tokens: CLAUDE_MAX_TOKENS,
                  // The tools and prompt are the same for every asker: the
                  // marker on the prompt caches both across asks, and the
                  // top-level marker lets a later round of this ask read the
                  // earlier rounds from the cache too.
                  system: claudeCachedSystem(systemPrompt()),
                  tools,
                  cache_control: { type: "ephemeral" },
                  output_config: { effort: CLAUDE_EFFORT },
                  messages,
                },
                { signal: controller.signal },
              )
              .finalMessage();
          } catch (error) {
            roundSpan?.setError(error);
            roundSpan?.end();
            setError(error);
            return toolResults.length ? { toolResults } : null;
          }
          roundSpan?.setUsage({
            promptTokens: claudePromptTokens(message.usage),
            completionTokens: message.usage.output_tokens,
          });
          logClaudeUsage(input.traceRoute, input.model, message.usage);
          const toolUses = message.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          );
          roundSpan?.setOutput(
            JSON.stringify({
              content:
                message.content
                  .flatMap((block) => (block.type === "text" ? [block.text] : []))
                  .join("") || null,
              toolCalls: toolUses.map((use) => use.name),
            }),
          );
          roundSpan?.end();

          if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
            return { toolResults };
          }

          // The whole assistant turn goes back, thinking blocks included.
          messages.push({ role: "assistant", content: message.content });
          // Claude needs a result for every call it made, so a call past the
          // round's cap gets an error result rather than none.
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const [index, use] of toolUses.entries()) {
            if (index >= MAX_TOOLS_PER_ROUND) {
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                is_error: true,
                content: JSON.stringify({ error: `Only ${MAX_TOOLS_PER_ROUND} tools run per round.` }),
              });
              continue;
            }
            const args =
              use.input && typeof use.input === "object" && !Array.isArray(use.input)
                ? (use.input as Record<string, unknown>)
                : null;
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              content: await askToolReply(use.name, args, { toolCall, ctx: input.ctx, toolResults }),
            });
          }
          // Every result goes back in one user message.
          messages.push({ role: "user", content: results });
        }

        return { toolResults };
      } catch (error) {
        setError(error);
        return toolResults.length ? { toolResults } : null;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/**
 * Run a bounded model tool loop: on Claude when the deploy has a Claude key
 * (or a test passes a Claude client), else on OpenRouter. An explicit
 * OpenRouter `apiKey` keeps the OpenRouter loop. Returns null when no key or
 * the request fails before any useful tool result. Traced as one AGENT span with
 * the model rounds and tool executions as children (see
 * lib/observability/arize.ts); inert without the Arize keys.
 */
export async function runAskModelLoop(input: {
  query: string;
  turns?: AskTurn[];
  ctx: AskToolContext;
  /** OpenRouter key; when given, the loop runs on OpenRouter. */
  apiKey?: string;
  /** Model for whichever provider runs the loop. */
  model?: string;
  /** Claude client (tests); the shared SDK client otherwise. */
  claude?: ClaudeClient;
  fetchImpl?: typeof fetch;
  /** Whole-loop deadline; defaults to TIMEOUT_MS. */
  timeoutMs?: number;
  /** Static route tag for the trace (e.g. "api/ask"). */
  traceRoute?: string;
}): Promise<ModelAskOutcome | null> {
  const claudeKey = claudeApiKey();
  if (!input.apiKey && (input.claude || claudeKey)) {
    return runAskClaudeLoop({
      query: input.query,
      turns: input.turns,
      ctx: input.ctx,
      client: input.claude ?? claudeClient(claudeKey!),
      model: input.model ?? claudeChatModel(ASK_CLAUDE_MODEL_ENV),
      timeoutMs: input.timeoutMs,
      traceRoute: input.traceRoute ?? "ask/model-loop",
    });
  }

  const apiKey = input.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const fetchImpl = input.fetchImpl ?? input.ctx.fetchImpl ?? fetch;
  const model =
    input.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_ASK_MODEL;

  const messages = askModelMessages(input.query, input.turns);

  return traceArizeModelLoop({
    route: input.traceRoute ?? "ask/model-loop",
    model,
    provider: "openrouter",
    prompt: input.query,
    invocationParameters: { temperature: 0, max_tokens: MAX_TOKENS },
    run: async ({ modelRound, toolCall, setError }) => {
      const toolResults: AskToolResult[] = [];
      let tracedMessageCount = 0;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? TIMEOUT_MS);

      try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const roundSpan = modelRound({
            prompt: JSON.stringify(messages.slice(tracedMessageCount)),
          });
          tracedMessageCount = messages.length;
          let message: ChatMessage | undefined;
          try {
            const response = await fetchImpl(
              openRouterChatCompletionsUrl(),
              askModelRequest({ apiKey, model, messages, signal: controller.signal }),
            );
            if (!response.ok) {
              const error = new Error(`OpenRouter responded ${response.status}.`);
              roundSpan?.setError(error);
              roundSpan?.end();
              setError(error);
              return toolResults.length ? { toolResults } : null;
            }
            const body = (await response.json()) as AskModelResponseBody;
            message = body.choices?.[0]?.message;
            roundSpan?.setUsage({
              promptTokens: body.usage?.prompt_tokens,
              completionTokens: body.usage?.completion_tokens,
              totalTokens: body.usage?.total_tokens,
            });
            if (!message) {
              const error = new Error("OpenRouter returned no message.");
              roundSpan?.setError(error);
              roundSpan?.end();
              setError(error);
              return toolResults.length ? { toolResults } : null;
            }

            roundSpan?.setOutput(
              JSON.stringify({
                content: message.content ?? null,
                toolCalls: (message.tool_calls ?? []).map(
                  (call) => call.function?.name ?? "",
                ),
              }),
            );
          } catch (error) {
            roundSpan?.setError(error);
            roundSpan?.end();
            throw error;
          }
          roundSpan?.end();

          const toolCalls = message.tool_calls ?? [];
          if (toolCalls.length === 0) {
            return { toolResults };
          }

          messages.push({
            role: "assistant",
            content: message.content ?? null,
            tool_calls: toolCalls,
          });

          await runAskLoopTools(
            toolCalls.slice(0, MAX_TOOLS_PER_ROUND),
            { toolCall, ctx: input.ctx, messages, toolResults },
          );
        }

        return { toolResults };
      } catch (error) {
        setError(error);
        return toolResults.length ? { toolResults } : null;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
