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
 * Run a bounded OpenRouter tool loop. Returns null when no API key or the
 * request fails before any useful tool result. Traced as one AGENT span with
 * the model rounds and tool executions as children (see
 * lib/observability/arize.ts); inert without the Arize keys.
 */
/**
 * Runs one loop round's tool calls (capped at three by the caller) and appends
 * each result to the running messages, so the loop body stays readable.
 * A tool failure rethrows: the round span records it and the round ends.
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
    input.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-5";

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt() }];
  for (const turn of input.turns ?? []) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content.slice(0, 800) });
    }
  }
  messages.push({ role: "user", content: input.query.slice(0, 500) });

  return traceArizeModelLoop({
    route: input.traceRoute ?? "ask/model-loop",
    model,
    provider: "openrouter",
    prompt: input.query,
    invocationParameters: { temperature: 0, max_tokens: MAX_TOKENS },
    run: async ({ modelRound, toolCall }) => {
      const toolResults: AskToolResult[] = [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const roundSpan = modelRound({
            prompt: JSON.stringify(messages),
          });
          try {
            const response = await fetchImpl(OPENROUTER_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                temperature: 0,
                max_tokens: MAX_TOKENS,
                tools: askToolDefinitions(),
                tool_choice: round === 0 ? "auto" : "auto",
                messages,
              }),
              signal: controller.signal,
            });
            if (!response.ok) {
              roundSpan?.setError(
                new Error(`OpenRouter responded ${response.status}.`),
              );
              roundSpan?.end();
              return toolResults.length ? { toolResults } : null;
            }
            const body = (await response.json()) as {
              choices?: Array<{
                message?: ChatMessage;
                finish_reason?: string;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };
            const message = body.choices?.[0]?.message;
            roundSpan?.setUsage({
              promptTokens: body.usage?.prompt_tokens,
              completionTokens: body.usage?.completion_tokens,
              totalTokens: body.usage?.total_tokens,
            });
            if (!message) {
              roundSpan?.setError(new Error("OpenRouter returned no message."));
              roundSpan?.end();
              return toolResults.length ? { toolResults } : null;
            }

            const toolCalls = message.tool_calls ?? [];
            roundSpan?.setOutput(
              JSON.stringify({
                content: message.content ?? null,
                toolCalls: toolCalls.map((call) => call.function?.name ?? ""),
              }),
            );
            roundSpan?.end();
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
          } catch (error) {
            roundSpan?.setError(error);
            roundSpan?.end();
            throw error;
          }
        }

        return { toolResults };
      } catch {
        return toolResults.length ? { toolResults } : null;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
