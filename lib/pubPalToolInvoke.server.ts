import "server-only";

import { composeAnswer } from "@/lib/ask/runAsk";
import { resolveLateFoodQuery } from "@/lib/ask/lateFoodQuestion";
import { answerLateFoodQuestion } from "@/lib/ask/lateFoodAnswer.server";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolArgs,
} from "@/lib/ask/tools";
import { isAskToolName } from "@/lib/ask/types";
import {
  pubPalGetHomeRegisterAnswer,
  resolvePubPalFenceIntent,
  type PubPalFenceTurn,
} from "@/lib/pubPalLlmFence";
import { extractArea, isIndependentAskTool, refineVenueBudgetFollowUp, resolveAskJourney, routeAskDeterministically, unsupportedPriceComparison } from "@/lib/ask/router";
import {
  appendPubPalToolTurn,
  pubPalTurnSaid,
  readPubPalToolTurn,
  readPubPalToolTurnBinding,
  type PubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";
import { palCrawlClarification } from "@/lib/palRecordReply";
import { palOnlyNewScope, type PalOnlyNewScope } from "@/lib/palTaste.server";

/**
 * "Somewhere new": the pubs the conversation's bound owner has been to, read
 * on the server only when search_venues asks for it. The history never leaves
 * the server; only the picks that remain do.
 */
async function onlyNewScope(
  toolName: string,
  args: AskToolArgs,
  conversationId: string | null,
): Promise<PalOnlyNewScope | null> {
  if (toolName !== "search_venues" || args.onlyNew !== true) return null;
  let ownerId: string | null;
  try {
    ownerId = conversationId ? (await readPubPalToolTurnBinding(conversationId))?.ownerId ?? null : null;
  } catch {
    return { hint: "I couldn't check where you've been, so some of these you may know." };
  }
  return palOnlyNewScope(ownerId);
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
  turns?: readonly PubPalFenceTurn[];
}): string {
  const fromTurn = input.turnQuery?.trim() ?? "";
  const fromArgs =
    typeof input.args.query === "string" ? input.args.query.trim() : "";
  const query = fromTurn ? resolveLateFoodQuery(fromTurn, input.turns) : fromArgs;
  const priorUsers = input.turns?.filter((turn) => turn.role === "user").map((turn) => turn.content);
  return refineVenueBudgetFollowUp(query, priorUsers) ?? query;
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

const SHOWN_PLACE_ARGS = ["area", "borough", "place", "to", "from", "venueName", "name"] as const;

function placeArgsThePersonSaid(args: AskToolArgs, turn: PubPalToolTurn | null, query: string): AskToolArgs {
  const kept: AskToolArgs = { ...args };
  const said = (value: string) => pubPalTurnSaid(turn ?? { query, turns: [] }, value);
  const selected = /\b(?:this|that|the selected|the first|the second)\s+(?:pub|venue|one)\b/i.test(query);
  const selectedIndex = /\bfirst\b/i.test(query) ? 0 : /\bsecond\b/i.test(query) ? 1 : null;
  const selectedCard = selectedIndex !== null ? turn?.cards[selectedIndex] : turn?.cards.length === 1 ? turn.cards[0] : undefined;
  const referenced = selected && selectedCard?.venueId === args.venueId;
  if (typeof kept.venueId === "string" && !said(kept.venueId) && !referenced) delete kept.venueId;
  if (kept.lat != null || kept.lng != null) {
    const lines = [query, ...(turn?.turns.filter((line) => line.role === "user").map((line) => line.content) ?? [])];
    const pair = `${kept.lat},${kept.lng}`;
    if (kept.lat == null || kept.lng == null || !lines.some((line) => line.replace(/\s+/g, "").includes(pair))) {
      delete kept.lat;
      delete kept.lng;
    }
  }
  for (const key of SHOWN_PLACE_ARGS) {
    const value = kept[key];
    if (typeof value !== "string" || isEmptyArg(value) || said(value) || (referenced && turn?.cards.some((card) => card.venueId === args.venueId && card.title === value))) continue;
    delete kept[key];
    const area = key === "area" || key === "borough" ? extractArea(query) : null;
    if (area) kept[key] = area;
  }
  return kept;
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
  const query = resolvePubPalToolQuery({ turnQuery: turn?.query, args: input.args, turns: turn?.turns });
  const cityId = resolveAskCityId(
    typeof input.args.cityId === "string" ? input.args.cityId : turn?.cityId,
  );
  const args = placeArgsThePersonSaid(enrichPubPalToolArgs(input.toolName, placeArgsThePersonSaid(input.args, turn, query), query), turn, query);

  const threadTurns = turn?.turns ?? [];
  const unsupported = unsupportedPriceComparison(query);
  const priceRefusal = unsupported && !isIndependentAskTool(input.toolName) ? unsupported : null;
  // The fence decides what the agent hears, never what the tool reads, and both
  // can take seconds, so they run together. A fenced turn drops the tool's
  // answer unread: nothing from it is appended, spoken or returned. A price ask
  // the tools cannot answer starts no tool at all.
  const scope = onlyNewScope(input.toolName, input.args, input.conversationId);
  const startTool = async () => (!isIndependentAskTool(input.toolName)
    ? answerLateFoodQuestion({ cityId, query, skipModel: true }, threadTurns) : null)
    ?? runAskTool(input.toolName, args, { cityId, query, skipModel: true, excludeVenueIds: (await scope)?.exclude });
  const clarification = input.toolName === "propose_plan" ? palCrawlClarification(query, threadTurns) : null;
  const journey = input.toolName === "journey" ? resolveAskJourney(query) : null;
  const missingOrigin = input.toolName === "journey" && !journey?.from && !args.from;
  const toolRun = priceRefusal || clarification || missingOrigin ? null : startTool();
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

  if (clarification) {
    if (input.conversationId) await appendPubPalToolTurn(input.conversationId, { hints: [clarification] });
    return { result: { ok: true, tool: input.toolName, answerHint: clarification, cards: [], proposals: [] } };
  }

  if (missingOrigin) {
    const answerHint = "Where are you travelling from?";
    if (input.conversationId) await appendPubPalToolTurn(input.conversationId, { hints: [answerHint], toolsUsed: [input.toolName] });
    return { result: { ok: false, tool: input.toolName, answerHint, cards: [], proposals: [] } };
  }

  const toolResult = await (toolRun ?? startTool());
  const scopeHint = (await scope)?.hint ?? "";
  const answerHint = [scopeHint, toolResult.answerHint].filter(Boolean).join(" ") || toolResult.answerHint;

  if (input.conversationId) {
    await appendPubPalToolTurn(input.conversationId, {
      cards: toolResult.cards,
      proposals: toolResult.proposals,
      hints: answerHint ? [answerHint] : [],
      toolsUsed: [toolResult.tool],
    });
  }

  const spokenHint =
    answerHint ??
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
      ...(toolResult.tool === "search_venues" || toolResult.tool === "cheapest_pint_near" ? { data: toolResult.data } : {}),
      ...(toolResult.priceEvidence ? { priceEvidence: toolResult.priceEvidence } : {}),
      sources: toolResult.provenance,
      proposals: toolResult.proposals,
      degraded: toolResult.degraded ?? false,
    },
  };
}
