// Orchestrate one Night OS Ask turn: deterministic tools and optional model loop.

import { recordedDrinkComparison, refineRoutedAskQuery, routeAskDeterministically, unsupportedPriceComparison } from "@/lib/ask/router";
import { routeAsk } from "@/lib/ask/routerJudged";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
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

function dedupeCards(results: AskToolResult[]): AskCard[] {
  const seen = new Set<string>();
  const out: AskCard[] = [];
  for (const result of results) {
    for (const card of result.cards) {
      const identity = JSON.stringify([
        card.venueId, card.title, card.place, card.note, card.price,
        card.provenance?.kind, card.provenance?.label, card.provenance?.url,
        card.menuEvidence,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push(card);
    }
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
  resolvedVenueId?: string;
} {
  const proposals: AskProposal[] = [];
  const sources: AskSource[] = [];
  const hintCandidates: Array<{ result: AskToolResult; hint: string }> = [];
  let degraded = false;
  const toolsUsed: string[] = [];

  for (const result of results) {
    toolsUsed.push(result.tool);
    proposals.push(...result.proposals);
    sources.push(...result.provenance);
    if (result.answerHint) hintCandidates.push({ result, hint: result.answerHint });
    if (result.degraded) degraded = true;
  }

  const totalCardCount = results.reduce((total, result) => total + result.cards.length, 0);
  const mergedCards = dedupeCards(results);
  const hasSearchCards = results.some((result) => result.tool === "search_venues" && result.ok && result.cards.length > 0);
  const hints = [...new Set(
    hintCandidates
      .filter(
        ({ result }) =>
          !(
            hasSearchCards &&
            result.tool === "search_venues" &&
            result.ok &&
            result.cards.length === 0 &&
            !result.degraded
          ),
      )
      .map(({ hint }) => hint),
  )];
  if (mergedCards.length < totalCardCount) {
    hints.push(`Showing the first ${mergedCards.length}.`);
  }
  const resolvedVenueId = results.find((result) => result.ok && result.resolvedVenueId)?.resolvedVenueId;

  return {
    cards: mergedCards,
    ...(resolvedVenueId ? { resolvedVenueId } : {}),
    proposals: dedupeProposals(proposals),
    sources: dedupeSources(sources),
    hints,
    degraded,
    toolsUsed: [...new Set(toolsUsed)],
  };
}

function composeAnswer(
  hints: string[],
  cards: AskCard[],
  toolsUsed: string[],
): string {
  if (cards.length > 0) {
    const pubPickTools = new Set(["search_venues", "cheapest_pint_near"]);
    const isPubPickAnswer =
      toolsUsed.length > 0 &&
      toolsUsed.every((tool) => pubPickTools.has(tool)) &&
      cards.every((card) => Boolean(card.venueId));
    if (!isPubPickAnswer) {
      return hints.length > 0 ? hints.join(" ") : "Nothing sourced for that. Try a nearby area or a broader ask.";
    }
    const countLine = `${cards.length} ${cards.length === 1 ? "pick" : "picks"} from the listed pubs, each with its source.`;
    return [countLine, ...hints].join(" ");
  }
  if (hints.length > 0) return hints.join(" ");
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
  /** Injected clock for the tools that read "tonight" or "now". */
  now?: number;
  /** Static route tag for the trace (e.g. "api/ask"). */
  traceRoute?: string;
};

/**
 * Run one Ask turn. Always returns a grounded body; never throws for soft
 * tool failures (those become degraded status + honest copy).
 */
export async function runAsk(input: RunAskInput): Promise<AskResponseBody & { resolvedVenueId?: string }> {
  const query = input.query.trim().slice(0, 500);
  const unsupported = unsupportedPriceComparison(query);
  const cityId = resolveAskCityId(input.cityId);
  const turns = normaliseTurns(input.turns);
  const ctx: AskToolContext = {
    cityId,
    query,
    skipModel: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  };

  const recordedDrinks = recordedDrinkComparison(query);
  let toolResults: AskToolResult[] = recordedDrinks || unsupported
    ? await Promise.all(routeAskDeterministically(query).map((call) => runAskTool(call.name, { ...call.args, query }, ctx)))
    : [];

  const allowModel =
    !unsupported && !recordedDrinks && !input.skipModel && Boolean(process.env.OPENROUTER_API_KEY);

  if (allowModel) {
    const modelOutcome = await runAskModelLoop({
      query,
      turns,
      ctx,
      ...(input.traceRoute ? { traceRoute: input.traceRoute } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (modelOutcome && modelOutcome.toolResults.length > 0) {
      toolResults = modelOutcome.toolResults;
    }
  }

  if (toolResults.length === 0 && !unsupported) {
    // Incorporate last user refinement phrases into the routed query when the
    // current ask is short ("cheaper", "closer to the Tube").
    const priorUser = [...turns].reverse().find((t) => t.role === "user");
    const routedQuery = refineRoutedAskQuery(query, priorUser?.content);
    let venues: Array<{ id: string; name: string; area: string }> = [];
    try {
      venues = (await loadConciergeVenues(cityId)).map((venue) => ({
        id: venue.id,
        name: venue.name,
        area: venue.area,
      }));
    } catch {
      venues = [];
    }
    const routed = await routeAsk(routedQuery, { venues });
    for (const call of routed.calls) {
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
    answer: composeAnswer(unsupported ? [unsupported.answer, ...merged.hints] : merged.hints, merged.cards, merged.toolsUsed),
    cards: merged.cards,
    proposals: merged.proposals,
    sources: merged.sources,
    status: merged.degraded ? "degraded" : "ready",
    toolsUsed: merged.toolsUsed,
    ...(merged.resolvedVenueId ? { resolvedVenueId: merged.resolvedVenueId } : {}),
  };
}

export { mergeToolResults, composeAnswer };
