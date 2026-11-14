import { refineRoutedAskQuery, routeAskDeterministically, socialTurnKind } from "@/lib/ask/router";
import type { AskProposal } from "@/lib/ask/types";
import { conciergeConstraintsInText, defaultKnownAreas } from "@/lib/concierge/intentPolicy";

type PalTurnLine = { role: string; content: string };
type PalConfirmedMemoryLine = { label: string; value: string };

export const PAL_ASK_FOR_CONSTRAINT = "Tell me an area, a mood or a budget and I'll find you a pub.";
export const PAL_RECORDS_UNREAD = "I couldn't check the records for that just now. Try again.";

const START_TIME_RE = /\b(?:tonight|today|tomorrow|this (?:evening|afternoon|weekend)|weekend|after work|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}(?:[:.]\d{2})?\s?[ap]m|\d{1,2}:\d{2}|noon|midday)\b/i;
const MEMORY_ASK_RE = /\b(?:what do you (?:remember|know) about me|what have i told you|my (?:saved )?(?:memories|preferences))\b/i;

const TOOL_PROGRESS: Readonly<Record<string, string>> = {
  search_venues: "Checking the listed pubs.",
  cheapest_pint_near: "Checking the listed pints.",
  propose_plan: "Checking which listed pubs walk as a crawl.",
  whats_on: "Checking the listings.",
  venue_prices: "Checking the price record.",
  venue_drinks: "Checking the drinks record.",
  venue_heritage: "Checking the pub's record.",
  tonight_now: "Checking what is listed tonight.",
  city_status: "Checking London live status.",
  journey: "Checking the journey.",
  area_buzz: "Checking the area.",
  propose_map_action: "Finding it on the map.",
  find_desk: "Checking the listed work spots.",
  report_occupancy: "Getting your report ready.",
  recall_memories: "Reading your confirmed memories.",
  propose_memory: "Making a memory card for you to check.",
};

export function palToolProgressLine(tool: string): string {
  return TOOL_PROGRESS[tool] ?? "Checking the records.";
}

export function palSocialReply(query: string, turns: readonly PalTurnLine[]): string | null {
  const social = socialTurnKind(query);
  if (!social) return null;
  if (social === "thanks") return "You're welcome.";
  return turns.some((turn) => turn.role === "assistant") ? "Hey." : "Hi. What kind of night are you planning?";
}

export function palProposalReply(proposals: readonly AskProposal[]): string | null {
  return proposals.some((proposal) => proposal.kind === "remember_memory")
    ? "Check the memory card. Nothing is saved until you confirm it."
    : null;
}

function crawlQuestion(needsArea: boolean, needsTime: boolean): string | null {
  if (needsArea && needsTime) return "Happy to plan the crawl. Which area, and what time are you starting?";
  if (needsArea) return "Happy to plan the crawl. Which area should it be in?";
  if (needsTime) return "Happy to plan the crawl. What time are you starting?";
  return null;
}

type PalNoRecordAnswer = { reply: string } | { lookup: { query: string; tool: string } };

function palNoRecordAnswer(
  query: string,
  turns: readonly PalTurnLine[],
  memories?: readonly PalConfirmedMemoryLine[] | null,
): PalNoRecordAnswer {
  const social = palSocialReply(query, turns);
  if (social) return { reply: social };
  if (MEMORY_ASK_RE.test(query)) {
    if (!memories) return { reply: "Your saved memories could not be read just now." };
    return {
      reply: memories.length > 0
        ? `You confirmed: ${memories.map((memory) => `${memory.label}: ${memory.value}`).join("; ")}.`
        : "You have not confirmed anything for me to remember yet.",
    };
  }
  const asks = turns.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const routed = refineRoutedAskQuery(query, asks.at(-1), asks);
  const tools = routeAskDeterministically(routed).map((call) => call.name);
  const intent = conciergeConstraintsInText(routed, defaultKnownAreas());
  if (tools.includes("propose_plan")) {
    const lines = [routed, ...asks];
    const question = crawlQuestion(
      !lines.some((line) => conciergeConstraintsInText(line, defaultKnownAreas()).area),
      !lines.some((line) => START_TIME_RE.test(line)),
    );
    if (question) return { reply: question };
  }
  const unconstrained = !intent.area && intent.mood.length === 0 && intent.maxPintPrice === undefined && intent.groupSize === undefined;
  return tools.length > 0 && !(tools.includes("search_venues") && unconstrained)
    ? { lookup: { query: routed, tool: tools[0]! } }
    : { reply: PAL_ASK_FOR_CONSTRAINT };
}

export function palNoRecordLookup(query: string, turns: readonly PalTurnLine[]): { query: string; tool: string } | null {
  const answer = palNoRecordAnswer(query, turns, null);
  return "lookup" in answer ? answer.lookup : null;
}

export function palNoRecordReply(
  query: string,
  turns: readonly PalTurnLine[],
  memories?: readonly PalConfirmedMemoryLine[] | null,
): string {
  const answer = palNoRecordAnswer(query, turns, memories);
  return "reply" in answer ? answer.reply : PAL_RECORDS_UNREAD;
}
