import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolArgs,
} from "@/lib/ask/tools";
import type { AskToolName } from "@/lib/ask/types";
import { isAskToolName } from "@/lib/ask/types";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import {
  appendPubPalToolTurn,
  readPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

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

  const turn = input.conversationId
    ? readPubPalToolTurn(input.conversationId)
    : null;
  const queryFromArgs =
    typeof input.args.query === "string" ? input.args.query.trim() : "";
  const query = queryFromArgs || turn?.query || "";
  const cityId = resolveAskCityId(
    typeof input.args.cityId === "string" ? input.args.cityId : turn?.cityId,
  );

  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query);
  if (fenced) {
    const register = pubPalGetHomeRegisterAnswer("", sobrietyOnly);
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

  const toolResult = await runAskTool(input.toolName as AskToolName, input.args, {
    cityId,
    query,
    skipModel: true,
  });

  if (input.conversationId && turn) {
    appendPubPalToolTurn(input.conversationId, {
      cards: toolResult.cards,
      proposals: toolResult.proposals,
      hints: toolResult.answerHint ? [toolResult.answerHint] : [],
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
      proposals: toolResult.proposals,
      degraded: toolResult.degraded ?? false,
    },
  };
}
