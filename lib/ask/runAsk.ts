// Orchestrate one Night OS Ask turn: deterministic tools and optional model loop.

import { routeAskDeterministically } from "@/lib/ask/router";
import { runAskModelLoop } from "@/lib/ask/modelLoop";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolContext,
  type AskToolResult,
} from "@/lib/ask/tools";
import type {
  AskCard,
  AskProposal,
  AskResponseBody,
  AskSource,
  AskTurn,
} from "@/lib/ask/types";

const MAX_TURNS = 6;

function dedupeCards(cards: AskCard[]): AskCard[] {
  const seen = new Set<string>();
  const out: AskCard[] = [];
  for (const card of cards) {
    if (seen.has(card.key)) continue;
    seen.add(card.key);
    out.push(card);
  }
  return out.slice(0, 8);
}

function dedupeProposals(proposals: AskProposal[]): AskProposal[] {
  const seen = new Set<string>();
  const out: AskProposal[] = [];
  for (const proposal of proposals) {
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);
    out.push(proposal);
  }
  return out.slice(0, 6);
}

function dedupeSources(sources: AskSource[]): AskSource[] {
  const seen = new Set<string>();
  const out: AskSource[] = [];
  for (const source of sources) {
    const key = `${source.kind}:${source.label}:${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function mergeToolResults(results: AskToolResult[]): {
  cards: AskCard[];
  proposals: AskProposal[];
  sources: AskSource[];
  hints: string[];
  degraded: boolean;
  toolsUsed: string[];
} {
  const cards: AskCard[] = [];
  const proposals: AskProposal[] = [];
  const sources: AskSource[] = [];
  const hints: string[] = [];
  let degraded = false;
  const toolsUsed: string[] = [];

  for (const result of results) {
    toolsUsed.push(result.tool);
    cards.push(...result.cards);
    proposals.push(...result.proposals);
    sources.push(...result.provenance);
    if (result.answerHint) hints.push(result.answerHint);
    if (result.degraded) degraded = true;
  }

  return {
    cards: dedupeCards(cards),
    proposals: dedupeProposals(proposals),
    sources: dedupeSources(sources),
    hints,
    degraded,
    toolsUsed: [...new Set(toolsUsed)],
  };
}

function composeAnswer(
  modelAnswer: string | null,
  hints: string[],
  cards: AskCard[],
): string {
  if (modelAnswer && modelAnswer.trim()) {
    // Strip common model flourishes that invent certainty without cards.
    return modelAnswer.trim().slice(0, 1200);
  }
  if (hints.length > 0) return hints.join(" ");
  if (cards.length > 0) {
    return `${cards.length} grounded ${cards.length === 1 ? "result" : "results"}. Confirm a proposal to act.`;
  }
  return "Nothing sourced for that. Try a nearby area or a broader ask.";
}

function normaliseTurns(raw: unknown): AskTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: AskTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!role || !content) continue;
    turns.push({ role, content: content.slice(0, 800) });
    if (turns.length >= MAX_TURNS) break;
  }
  return turns;
}

export type RunAskInput = {
  query: string;
  cityId?: unknown;
  turns?: unknown;
  /** When true, never call OpenRouter (tests / production without durable limiter). */
  skipModel?: boolean;
  fetchImpl?: typeof fetch;
};

/**
 * Run one Ask turn. Always returns a grounded body; never throws for soft
 * tool failures (those become degraded status + honest copy).
 */
export async function runAsk(input: RunAskInput): Promise<AskResponseBody> {
  const query = input.query.trim().slice(0, 500);
  const cityId = resolveAskCityId(input.cityId);
  const turns = normaliseTurns(input.turns);
  const ctx: AskToolContext = {
    cityId,
    query,
    skipModel: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };

  let toolResults: AskToolResult[] = [];
  let modelAnswer: string | null = null;

  const allowModel =
    !input.skipModel && Boolean(process.env.OPENROUTER_API_KEY);

  if (allowModel) {
    const modelOutcome = await runAskModelLoop({
      query,
      turns,
      ctx,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (modelOutcome && modelOutcome.toolResults.length > 0) {
      toolResults = modelOutcome.toolResults;
      modelAnswer = modelOutcome.answer;
    }
  }

  if (toolResults.length === 0) {
    // Incorporate last user refinement phrases into the routed query when the
    // current ask is short ("cheaper", "closer to the Tube").
    let routedQuery = query;
    const priorUser = [...turns].reverse().find((t) => t.role === "user");
    if (priorUser && query.split(/\s+/).length <= 4) {
      routedQuery = `${priorUser.content}. ${query}`;
    }
    const routed = routeAskDeterministically(routedQuery);
    for (const call of routed) {
      toolResults.push(
        await runAskTool(call.name, { ...call.args, query: routedQuery }, {
          ...ctx,
          query: routedQuery,
        }),
      );
    }
  }

  const merged = mergeToolResults(toolResults);
  return {
    answer: composeAnswer(modelAnswer, merged.hints, merged.cards),
    cards: merged.cards,
    proposals: merged.proposals,
    sources: merged.sources,
    status: merged.degraded ? "degraded" : "ready",
    toolsUsed: merged.toolsUsed,
  };
}

export { normaliseTurns, mergeToolResults, composeAnswer };
