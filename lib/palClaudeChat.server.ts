import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { PalChatDeadlineExceeded, beforePalChatDeadline } from "@/lib/palChatDeadline";
import {
  PAL_RECALL_MEMORIES_TOOL,
  recallPalMemoriesForConversation,
} from "@/lib/palConfirmedMemories.server";
import {
  palChatAnswer,
  palChatFailureRecorder,
  palUserMessageText,
  preparePalChatProviderTurn,
  type PalElevenLabsChatContext,
  type PalElevenLabsChatInput,
  type PalElevenLabsChatOutcome,
} from "@/lib/palElevenLabsChat.server";
import {
  PAL_PROPOSE_MEMORY_TOOL,
  proposePalMemoryForConversation,
} from "@/lib/palMemoryProposal.server";
import { pubPalTypedChatSystemPrompt } from "@/lib/palVoicePrompt.mjs";
import { traceArizeModelLoop } from "@/lib/observability/arize";
import { newPalLocalThreadId } from "@/lib/pubPalConversationId";
import {
  PUB_PAL_TOOL_DESCRIPTIONS,
  PUB_PAL_TOOL_NAMES,
  pubPalToolArgumentProperties,
} from "@/lib/pubPalToolCatalog.mjs";
import { invokePubPalAskTool } from "@/lib/pubPalToolInvoke.server";
import { readPubPalToolTurn, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

// Typed Pub Pal chat on the Claude API. It answers the same turn the ElevenLabs
// agent answers (lib/palElevenLabsChat.server.ts): the same owned history,
// safety fence, record answers, memories, prompt rules and tools. Only the
// model call differs. Voice stays on ElevenLabs.
//
// The host is named here so /privacy can be held to it (__tests__/legalPages.test.ts).
const PAL_CLAUDE_API_HOST = "api.anthropic.com";
/** A fast, low-cost model. `PUB_PAL_CLAUDE_MODEL` overrides it without a deploy of code. */
export const PAL_CLAUDE_DEFAULT_MODEL = "claude-haiku-5-5";
// Each round is one model call. Four leaves room for a memory read, two
// factual tools and the reply; the turn deadline still bounds the whole loop.
const MAX_ROUNDS = 4;
// Thinking counts toward this cap, so it leaves room above a short reply.
const MAX_TOKENS = 2_048;
// Chat replies are short and grounded in tool results. Low effort keeps them quick.
const EFFORT = "low" as const;
// A tool result goes back to the model as text. Tools cap their own rows, and
// this is the backstop.
const TOOL_RESULT_CHAR_LIMIT = 24_000;

/** Whether this deploy sends typed Pub Pal chat to Claude. */
export function palClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function palClaudeModel(): string {
  return process.env.PUB_PAL_CLAUDE_MODEL?.trim() || PAL_CLAUDE_DEFAULT_MODEL;
}

type PalClaudeStream = {
  on(event: "text", listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
};

/** The one SDK call the turn makes, so a test can pass a fake. */
export type PalClaudeClient = {
  stream(body: Anthropic.MessageStreamParams, options: { signal: AbortSignal }): PalClaudeStream;
};

type PalClaudeToolRunner = (
  name: string,
  args: Record<string, unknown>,
  conversationId: string,
) => Promise<Record<string, unknown>>;

export type PalClaudeDependencies = {
  client?: PalClaudeClient;
  runTool?: PalClaudeToolRunner;
};

function sdkClient(apiKey: string): PalClaudeClient {
  // One retry: the turn deadline is short, and the caller retries a 503.
  const anthropic = new Anthropic({ apiKey, baseURL: `https://${PAL_CLAUDE_API_HOST}`, maxRetries: 1 });
  return { stream: (body, options) => anthropic.messages.stream(body, options) };
}

/** Runs a tool in this process, through the same code the ElevenLabs webhooks call. */
async function runPalTool(
  name: string,
  args: Record<string, unknown>,
  conversationId: string,
): Promise<Record<string, unknown>> {
  if (name === PAL_RECALL_MEMORIES_TOOL) return (await recallPalMemoriesForConversation(conversationId)).result;
  if (name === PAL_PROPOSE_MEMORY_TOOL) return (await proposePalMemoryForConversation(conversationId, args)).result;
  return (await invokePubPalAskTool({ toolName: name, args, conversationId })).result;
}

const PAL_TOOLS: Anthropic.Tool[] = PUB_PAL_TOOL_NAMES.map((name) => ({
  name,
  description: PUB_PAL_TOOL_DESCRIPTIONS[name] ?? "PUBMAXX grounded tool.",
  input_schema: { type: "object", properties: { ...pubPalToolArgumentProperties(name) } },
}));

function toolResultText(result: Record<string, unknown>): string {
  const text = JSON.stringify(result);
  return text.length > TOOL_RESULT_CHAR_LIMIT ? text.slice(0, TOOL_RESULT_CHAR_LIMIT) : text;
}

function replyText(message: Anthropic.Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

export async function runPalClaudeChatTurn(
  input: PalElevenLabsChatInput,
  context?: PalElevenLabsChatContext,
  dependencies: PalClaudeDependencies = {},
): Promise<PalElevenLabsChatOutcome> {
  const recordFailure = palChatFailureRecorder(input);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey && !dependencies.client) {
    recordFailure("UNAVAILABLE", "configuration");
    return { ok: false, code: "UNAVAILABLE" };
  }

  const prepared = await preparePalChatProviderTurn(input, context, recordFailure);
  if ("outcome" in prepared) return prepared.outcome;
  const { query, cityId, deadline, prior, memoriesRead, tasteRead } = prepared.turn;

  // Claude keeps no conversation, so the thread is ours: the earlier one when
  // this continues it, else a new local id. The tools read the ask and the
  // owner from this row, as they read an ElevenLabs conversation's row.
  const conversationId = prior.conversationId ?? newPalLocalThreadId();
  let userText: string;
  try {
    const [, memories, taste] = await beforePalChatDeadline(deadline, () =>
      Promise.all([
        registerPubPalToolTurn(conversationId, {
          deadline,
          query,
          cityId,
          ownerId: input.ownerId,
          turns: prior.turns,
          summary: prior.summary,
        }),
        memoriesRead,
        tasteRead,
      ]),
    );
    userText = palUserMessageText(query, prior, memories, taste);
  } catch (error) {
    const code = error instanceof PalChatDeadlineExceeded ? "TIMEOUT" : "UNAVAILABLE";
    recordFailure(code, "registration");
    return { ok: false, code };
  }

  const client = dependencies.client ?? sdkClient(apiKey!);
  const runTool = dependencies.runTool ?? runPalTool;
  const model = palClaudeModel();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));
  const onCallerAbort = () => abort.abort();
  if (input.signal?.aborted) abort.abort();
  input.signal?.addEventListener("abort", onCallerAbort, { once: true });

  const failed = (code: Extract<PalElevenLabsChatOutcome, { ok: false }>["code"]): PalElevenLabsChatOutcome => {
    recordFailure(code, input.signal?.aborted ? "caller_cancel" : abort.signal.aborted ? "deadline" : "model");
    return { ok: false, code };
  };

  try {
    return await traceArizeModelLoop({
      route: "api/pub-pal/chat",
      model,
      provider: "anthropic",
      prompt: query,
      invocationParameters: { max_tokens: MAX_TOKENS, effort: EFFORT },
      run: async ({ modelRound, toolCall, setError }) => {
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          if (abort.signal.aborted) return failed("TIMEOUT");
          const span = modelRound({});
          let streamedText = false;
          let message: Anthropic.Message;
          try {
            const stream = client.stream(
              {
                model,
                max_tokens: MAX_TOKENS,
                system: pubPalTypedChatSystemPrompt(),
                tools: PAL_TOOLS,
                // The prompt and tools are the same every round, so a later
                // round of this turn reads them from the cache.
                cache_control: { type: "ephemeral" },
                output_config: { effort: EFFORT },
                messages,
              },
              { signal: abort.signal },
            );
            stream.on("text", (delta) => {
              if (!delta) return;
              streamedText = true;
              input.onProgress?.({ type: "delta", text: delta });
            });
            message = await stream.finalMessage();
          } catch (error) {
            span.setError(error);
            span.end();
            setError(error);
            return failed(abort.signal.aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE");
          }
          span.setUsage({
            promptTokens:
              message.usage.input_tokens +
              (message.usage.cache_read_input_tokens ?? 0) +
              (message.usage.cache_creation_input_tokens ?? 0),
            completionTokens: message.usage.output_tokens,
          });
          const reply = replyText(message);
          span.setOutput(reply);
          span.end();

          const toolUses = message.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          );
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
            // A refusal, or a reply cut off before any text, is no answer.
            if (message.stop_reason === "refusal" || !reply) {
              setError(new Error(`Claude stopped with ${message.stop_reason ?? "no reason"}.`));
              return failed("PROVIDER_UNAVAILABLE");
            }
            const turn = await beforePalChatDeadline(deadline, () => readPubPalToolTurn(conversationId));
            return palChatAnswer(reply, turn, conversationId);
          }

          // Text before a tool call is not the answer. Tell the reader to clear it.
          if (streamedText) input.onProgress?.({ type: "reset" });
          // The whole assistant turn goes back, thinking blocks included.
          messages.push({ role: "assistant", content: message.content });
          const results = await Promise.all(
            toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
              const args =
                use.input && typeof use.input === "object" && !Array.isArray(use.input)
                  ? (use.input as Record<string, unknown>)
                  : {};
              const toolSpan = toolCall({ name: use.name, input: args });
              try {
                const result = await beforePalChatDeadline(deadline, () => runTool(use.name, args, conversationId));
                toolSpan?.end();
                return { type: "tool_result", tool_use_id: use.id, content: toolResultText(result) };
              } catch (error) {
                toolSpan?.setError(error);
                toolSpan?.end();
                if (error instanceof PalChatDeadlineExceeded) throw error;
                return {
                  type: "tool_result",
                  tool_use_id: use.id,
                  is_error: true,
                  content: "That tool failed. Say it could not be checked just now.",
                };
              }
            }),
          );
          // Every result goes back in one user message.
          messages.push({ role: "user", content: results });
        }
        setError(new Error("Pub Pal used every model round without a reply."));
        return failed("PROVIDER_UNAVAILABLE");
      },
    });
  } catch (error) {
    if (error instanceof PalChatDeadlineExceeded) return failed("TIMEOUT");
    return failed("UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onCallerAbort);
  }
}
