// OpenRouter tool-calling loop for Night OS Ask. Allowlisted tools only;
// temperature 0; capped rounds. Falls back to null so the deterministic path
// can answer when the model is missing or fails.

import {
  askToolDefinitions,
  runAskTool,
  type AskToolContext,
  type AskToolResult,
} from "@/lib/ask/tools";
import { isAskToolName, type AskTurn } from "@/lib/ask/types";
import { traceArizeModelLoop, type ArizeModelLoopSpans } from "@/lib/observability/arize";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ROUNDS = 3;
const MAX_TOKENS = 500;
const TIMEOUT_MS = 12_000;
export const DEFAULT_ASK_MODEL = "anthropic/claude-sonnet-4-5";

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
    "You are the Night OS Ask assistant for PUBMAXXING, a London pub night planner.",
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
  /** Allowlisted tool names among the first three calls, in call order. */
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
      OPENROUTER_URL,
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
      .map((call) => call.function?.name ?? "")
      .filter((name) => isAskToolName(name));
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

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Runs one loop round's tool calls (capped at three by the caller) and appends
 * each result to the running messages, so the loop body stays readable.
 * A tool failure rethrows: the tool span records it and the loop ends.
 */
async function runAskLoopTools(
  calls: NonNullable<ChatMessage["tool_calls"]>,
  handlers: {
    toolCall: ArizeModelLoopSpans["toolCall"];
    ctx: AskToolContext;
    messages: ChatMessage[];
    toolResults: AskToolResult[];
  },
): Promise<void> {
  for (const call of calls) {
    const name = call.function?.name ?? "";
    if (!isAskToolName(name)) {
      handlers.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ error: "Tool not allowlisted." }),
      });
      continue;
    }
    const args = parseArgs(call.function.arguments);
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
    handlers.messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify({
        ok: result.ok,
        answerHint: result.answerHint,
        cardCount: result.cards.length,
        proposalCount: result.proposals.length,
        degraded: result.degraded === true,
        data: result.data,
      }).slice(0, 6000),
    });
  }
}

/**
 * Run a bounded OpenRouter tool loop. Returns null when no API key or the
 * request fails before any useful tool result. Traced as one AGENT span with
 * the model rounds and tool executions as children (see
 * lib/observability/arize.ts); inert without the Arize keys.
 */
export async function runAskModelLoop(input: {
  query: string;
  turns?: AskTurn[];
  ctx: AskToolContext;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Static route tag for the trace (e.g. "api/ask"). */
  traceRoute?: string;
}): Promise<ModelAskOutcome | null> {
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
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const roundSpan = modelRound({
            prompt: JSON.stringify(messages.slice(tracedMessageCount)),
          });
          tracedMessageCount = messages.length;
          let message: ChatMessage | undefined;
          try {
            const response = await fetchImpl(
              OPENROUTER_URL,
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
            toolCalls.slice(0, 3),
            {
              toolCall,
              ctx: input.ctx,
              messages,
              toolResults,
            },
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
