import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolArgs,
} from "@/lib/ask/tools";
import { isAskToolName } from "@/lib/ask/types";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import { isIndependentAskTool, routeAskDeterministically, unsupportedPriceComparison } from "@/lib/ask/router";
import {
  appendPubPalToolTurn,
  readPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

function isEmptyArg(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

/** ElevenLabs webhooks may send a short query fragment; the tool-turn store holds the full ask. */
export function resolvePubPalToolQuery(input: {
  turnQuery?: string | null;
  args: AskToolArgs;
}): string {
  const fromTurn = input.turnQuery?.trim() ?? "";
  const fromArgs =
    typeof input.args.query === "string" ? input.args.query.trim() : "";
  return fromTurn || fromArgs;
}

export function enrichPubPalToolArgs(
  toolName: string,
  args: AskToolArgs,
  query: string,
): AskToolArgs {
  if (!isAskToolName(toolName) || !query.trim()) return args;
  const routed = routeAskDeterministically(query).find((call) => call.name === toolName);
  if (!routed) return args;
  const merged: AskToolArgs = { ...args };
  for (const [key, value] of Object.entries(routed.args)) {
    if (isEmptyArg(merged[key])) merged[key] = value;
  }
  return merged;
}

type PubPalToolWebhookBody = {
  tool_call_id?: string;
  tool_name?: string;
  conversation_id?: string;
  parameters?: Record<string, unknown>;
};

export function parsePubPalToolWebhookBody(body: unknown): {
  conversationId: string | null;
  args: AskToolArgs;
} {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as PubPalToolWebhookBody & Record<string, unknown>)
      : {};
  const conversationId =
    typeof record.conversation_id === "string" && record.conversation_id.trim()
      ? record.conversation_id.trim()
      : null;
  const nested =
    record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
      ? (record.parameters as Record<string, unknown>)
      : null;
  const argsSource = nested ?? record;
  const args: AskToolArgs = {};
  for (const [key, value] of Object.entries(argsSource)) {
    if (key === "conversation_id" || key === "tool_call_id" || key === "tool_name") {
      continue;
    }
    args[key] = value;
  }
  return { conversationId, args };
}

export async function invokePubPalAskTool(input: {
  toolName: string;
  args: AskToolArgs;
  conversationId: string | null;
}): Promise<{ result: Record<string, unknown> }> {
  if (!isAskToolName(input.toolName)) {
    return {
      result: {
        ok: false,
        answerHint: "That tool is not available.",
      },
    };
  }

  if (!input.conversationId) {
    console.warn("pub-pal-tool.uncorrelated", { toolName: input.toolName });
  }
  const turn = input.conversationId
    ? await readPubPalToolTurn(input.conversationId)
    : null;
  const query = resolvePubPalToolQuery({ turnQuery: turn?.query, args: input.args });
  const cityId = resolveAskCityId(
    typeof input.args.cityId === "string" ? input.args.cityId : turn?.cityId,
  );
  const args = enrichPubPalToolArgs(input.toolName, input.args, query);

  const threadTurns = turn?.turns ?? [];
  const unsupported = unsupportedPriceComparison(query);
  const priceRefusal = unsupported && !isIndependentAskTool(input.toolName) ? unsupported : null;
  // The fence decides what the agent hears, never what the tool reads, and both
  // can take seconds, so they run together. A fenced turn drops the tool's
  // answer unread: nothing from it is appended, spoken or returned. A price ask
  // the tools cannot answer starts no tool at all.
  const startTool = () => runAskTool(input.toolName, args, { cityId, query, skipModel: true });
  const toolRun = priceRefusal ? null : startTool();
  // Awaited below on the unfenced path; this only keeps a fenced turn's
  // discarded run from surfacing as an unhandled rejection.
  toolRun?.catch(() => {});
  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query, threadTurns);
  if (fenced) {
    const register = pubPalGetHomeRegisterAnswer("", sobrietyOnly);
    if (input.conversationId) {
      try {
        await appendPubPalToolTurn(input.conversationId, {
          hints: [register],
          toolsUsed: [input.toolName],
        });
      } catch (error) {
        console.warn("pub-pal-tool.fenced-append-failed", {
          toolName: input.toolName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      result: {
        ok: true,
        fenced: true,
        answerHint: register,
        cards: [],
        proposals: [],
      },
    };
  }

  if (priceRefusal) {
    if (input.conversationId) {
      await appendPubPalToolTurn(input.conversationId, { hints: [priceRefusal.answer] });
    }
    return {
      result: {
        ok: false,
        code: priceRefusal.code,
        answerHint: priceRefusal.answer,
        cards: [],
        proposals: [],
      },
    };
  }

  const toolResult = await (toolRun ?? startTool());

  if (input.conversationId) {
    await appendPubPalToolTurn(input.conversationId, {
      cards: toolResult.cards,
      proposals: toolResult.proposals,
      hints: toolResult.answerHint ? [toolResult.answerHint] : [],
      toolsUsed: [toolResult.tool],
    });
  }

  const spokenHint =
    toolResult.answerHint ??
    composeAnswer(
      toolResult.cards.length > 0 ? [`${toolResult.cards.length} sourced result(s).`] : [],
      toolResult.cards,
      [toolResult.tool],
    );

  return {
    result: {
      ok: toolResult.ok,
      tool: toolResult.tool,
      answerHint: spokenHint,
      cards: toolResult.cards,
      ...(toolResult.priceEvidence ? { priceEvidence: toolResult.priceEvidence } : {}),
      sources: toolResult.provenance,
      proposals: toolResult.proposals,
      degraded: toolResult.degraded ?? false,
    },
  };
}
