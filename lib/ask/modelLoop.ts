// Model tool-calling loop for Night OS Ask. Allowlisted tools only; capped
// rounds. Claude answers when the deploy has a Claude Platform key
// (lib/claudeClient.server.ts, the client typed Pub Pal chat shares). Falls
// back to null so the deterministic path can answer when the key is missing or
// the model fails.

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
  claudeClient,
  claudeConfigured,
  claudeModel,
  claudePromptTokens,
  type ClaudeClient,
} from "@/lib/claudeClient.server";
import { traceArizeModelLoop, type ArizeModelLoopSpans } from "@/lib/observability/arize";

const MAX_ROUNDS = 3;
/** Tool calls one model round may run. */
const MAX_TOOLS_PER_ROUND = 3;
const TIMEOUT_MS = 12_000;
// Claude thinks before it calls a tool, and thinking counts toward this cap,
// so it leaves room above the tool call itself.
const CLAUDE_MAX_TOKENS = 1_024;
// Ask's model only chooses tools; low effort keeps that quick and cheap.
const CLAUDE_EFFORT = "low" as const;

/** Whether this deploy has a model for Ask. */
export function askModelConfigured(): boolean {
  return claudeConfigured();
}

export type ModelAskOutcome = {
  toolResults: AskToolResult[];
};

function systemPrompt(): string {
  return [
    "You are the Night OS Ask assistant for PUBMAXX, a London pub night planner.",
    "Use ONLY the provided tools. Never invent pubs, prices, listings, or transit facts.",
    "If a tool returns nothing, say so plainly. Prefer short British English.",
    "For map moves or plans, call propose_map_action or propose_plan - the user must confirm.",
    "Do not claim a community price moves the map unless the tool says it is corroborated.",
    "A zone estimate is not a recorded price: always call it an estimate and name its zone.",
  ].join(" ");
}

type AskToolHandlers = {
  toolCall: ArizeModelLoopSpans["toolCall"];
  ctx: AskToolContext;
  toolResults: AskToolResult[];
};

/**
 * Runs one model tool call and returns the reply the model reads, as JSON
 * text. A name off the allowlist
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
 * Run a bounded model tool loop on Claude, on the shared SDK client unless a
 * test or eval passes one. Returns null when there is no key or the request
 * fails before any useful tool result. Traced as one AGENT span with the model
 * rounds and tool executions as children. See docs/rules/lib-observability.md
 * for the Arize and PostHog activation rules.
 */
export async function runAskModelLoop(input: {
  query: string;
  turns?: AskTurn[];
  ctx: AskToolContext;
  /** Claude model; the shared model otherwise. */
  model?: string;
  /** Claude client (tests and evals); the shared SDK client otherwise. */
  claude?: ClaudeClient;
  /** Whole-loop deadline; defaults to TIMEOUT_MS. */
  timeoutMs?: number;
  /** Static route tag for the trace (e.g. "api/ask"). */
  traceRoute?: string;
}): Promise<ModelAskOutcome | null> {
  const key = claudeApiKey();
  if (!input.claude && !key) return null;
  const client = input.claude ?? claudeClient(key!);
  const model = input.model ?? claudeModel();
  const messages = askClaudeMessages(input.query, input.turns);
  const tools = askClaudeTools();

  return traceArizeModelLoop({
    route: input.traceRoute ?? "ask/model-loop",
    model,
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
            message = await client
              .stream(
                {
                  model,
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
