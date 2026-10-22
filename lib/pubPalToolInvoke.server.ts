import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolArgs,
  type AskToolResult,
} from "@/lib/ask/tools";
import type { AskToolName } from "@/lib/ask/types";
import { isAskToolName } from "@/lib/ask/types";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
} from "@/lib/pubPalLlmFence";
import { routeAskDeterministically } from "@/lib/ask/router";
import {
  appendPubPalToolTurn,
  readPubPalToolInvocationTurn,
} from "@/lib/pubPalToolTurnStore";
import {
  PUB_PAL_ROUTE_PROPOSALS_OFF,
  pubPalRouteProposalsAllowed,
} from "@/lib/pubPalRouteProposalPolicy.server";

function routeProposalsOffResult(): AskToolResult {
  return {
    ok: true,
    tool: "propose_plan",
    data: null,
    provenance: [],
    cards: [],
    proposals: [],
    answerHint: PUB_PAL_ROUTE_PROPOSALS_OFF,
  };
}

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
  if (fromTurn.length >= fromArgs.length) return fromTurn || fromArgs;
  return fromArgs || fromTurn;
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

  const invocation = input.conversationId
    ? await readPubPalToolInvocationTurn(input.conversationId)
    : null;
  const turn = invocation?.turn ?? null;
  const query = resolvePubPalToolQuery({ turnQuery: turn?.query, args: input.args });
  const cityId = resolveAskCityId(
    typeof input.args.cityId === "string" ? input.args.cityId : turn?.cityId,
  );
  const args = enrichPubPalToolArgs(input.toolName, input.args, query);

  const threadTurns = turn?.turns ?? [];
  const { fenced, sobrietyOnly } = await resolvePubPalFenceIntent(query, threadTurns);
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

  const ownerId = invocation?.origin.ownerId ?? null;
  const routeTool = input.toolName === "propose_plan";
  let toolResult = routeTool && !await pubPalRouteProposalsAllowed(ownerId)
    ? routeProposalsOffResult()
    : await runAskTool(input.toolName as AskToolName, args, {
      cityId,
      query,
      skipModel: true,
    });
  if (
    (routeTool || toolResult.proposals.some((proposal) => proposal.kind === "draft_plan")) &&
    !await pubPalRouteProposalsAllowed(ownerId)
  ) {
    toolResult = routeProposalsOffResult();
  }

  if (input.conversationId && invocation) {
    await appendPubPalToolTurn(input.conversationId, {
      cards: toolResult.cards,
      proposals: toolResult.proposals,
      hints: toolResult.answerHint ? [toolResult.answerHint] : [],
      toolsUsed: [input.toolName],
    }, invocation.origin);
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
