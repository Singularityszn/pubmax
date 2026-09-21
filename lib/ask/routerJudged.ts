import "server-only";

import type { Questions } from "@typesafe-ai/sdk";

import { systemOneOutcome, type SystemOneOutcome } from "@/lib/ai/typesafe.server";
import {
  findAskAreaCandidates,
  findAskVenueCandidates,
  type AskVenueCandidate,
} from "@/lib/ask/routerCandidates";
import {
  ASK_ROUTER_NONE,
  ASK_ROUTER_WANTS_MAP_FLOOR,
  judgedToolClearsFloor,
  overlayChoiceClearsFloor,
  parseAskRouterJudgment,
  type AskRouterDropReason,
  type AskRouterJudgment,
} from "@/lib/ask/routerPolicy";
import { buildAskRouterQuestions } from "@/lib/ask/routerQuestions";
import {
  routeAskDeterministically,
  type RoutedToolCall,
} from "@/lib/ask/router";
import { isAskToolName, type AskToolName } from "@/lib/ask/types";
import { recordTypesafeTiming } from "@/lib/routeObservability";

export type AskRouterContext = {
  venues?: readonly AskVenueCandidate[];
  nearbyVenues?: readonly AskVenueCandidate[];
  recentlyViewed?: readonly AskVenueCandidate[];
};

export type AskRouteResult = {
  calls: RoutedToolCall[];
  source: "judged" | "regex";
  dropReason?: AskRouterDropReason;
};

function regexResult(query: string, dropReason?: AskRouterDropReason): AskRouteResult {
  return {
    calls: routeAskDeterministically(query),
    source: "regex",
    ...(dropReason ? { dropReason } : {}),
  };
}

function fallbackAfterOk(
  query: string,
  dropReason: AskRouterDropReason,
): AskRouteResult {
  recordTypesafeTiming("typesafe", 0, "skipped", { dropReason: `ask-router-${dropReason}` });
  return regexResult(query, dropReason);
}

function dropFromOutcome(
  outcome: Exclude<SystemOneOutcome<Questions>, { status: "ok" }>,
): AskRouterDropReason {
  if (outcome.status === "skipped") {
    return outcome.reason === "budget" ? "budget" : "no_key";
  }
  return outcome.reason === "timeout" ? "timeout" : "error";
}

function defaultCall(
  name: AskToolName,
  query: string,
  overlays: { venueName?: string; area?: string },
): RoutedToolCall {
  switch (name) {
    case "search_venues":
      return { name, args: { query, limit: 4 } };
    case "whats_on":
      return { name, args: { query } };
    case "venue_heritage":
      return {
        name,
        args: overlays.venueName
          ? { venueName: overlays.venueName, query }
          : { query },
      };
    case "venue_prices":
      return {
        name,
        args: overlays.venueName
          ? { venueName: overlays.venueName, query }
          : { query },
      };
    case "city_status":
      return { name, args: {} };
    case "journey":
      return { name, args: { from: "London Bridge", to: overlays.venueName ?? query } };
    case "area_buzz":
      return { name, args: { area: overlays.area ?? "Westminster" } };
    case "propose_plan":
      return { name, args: { query } };
    case "propose_map_action":
      return {
        name,
        args: overlays.venueName ? { venueName: overlays.venueName } : { query },
      };
    case "cheapest_pint_near":
      if (overlays.area) return { name, args: { area: overlays.area } };
      if (overlays.venueName) return { name, args: { venueName: overlays.venueName } };
      return { name, args: {} };
    case "tonight_now":
      return { name, args: overlays.area ? { area: overlays.area } : {} };
    case "venue_drinks":
      return { name, args: overlays.venueName ? { venueName: overlays.venueName } : {} };
    case "find_desk":
      return { name, args: overlays.area ? { area: overlays.area } : {} };
    case "report_occupancy":
      return {
        name,
        args: {
          level: query,
          ...(overlays.venueName ? { venueName: overlays.venueName } : {}),
        },
      };
  }
}

function applyOverlays(
  call: RoutedToolCall,
  overlays: { venueName?: string; area?: string },
): RoutedToolCall {
  const args = { ...call.args };
  if (overlays.venueName && "venueName" in args) args.venueName = overlays.venueName;
  if (overlays.area && "area" in args) args.area = overlays.area;
  if (call.name === "journey" && overlays.venueName) args.to = overlays.venueName;
  return { name: call.name, args };
}

function overlaysFromJudgment(
  judgment: AskRouterJudgment,
  venues: readonly AskVenueCandidate[],
  areas: readonly { id: string; name: string }[],
): { venueName?: string; area?: string } {
  const overlays: { venueName?: string; area?: string } = {};
  if (
    judgment.venue !== ASK_ROUTER_NONE &&
    overlayChoiceClearsFloor(judgment.venueProbability, judgment.venueConfidence)
  ) {
    const hit = venues.find((venue) => venue.id === judgment.venue);
    if (hit) overlays.venueName = hit.name;
  }
  if (
    judgment.area !== ASK_ROUTER_NONE &&
    overlayChoiceClearsFloor(judgment.areaProbability, judgment.areaConfidence)
  ) {
    const hit = areas.find((area) => area.id === judgment.area);
    if (hit) overlays.area = hit.name;
  }
  return overlays;
}

function callsFromJudgment(
  query: string,
  judgment: AskRouterJudgment,
  venues: readonly AskVenueCandidate[],
  areas: readonly { id: string; name: string }[],
): RoutedToolCall[] {
  if (!isAskToolName(judgment.tool)) return routeAskDeterministically(query);
  const overlays = overlaysFromJudgment(judgment, venues, areas);
  const regex = routeAskDeterministically(query);
  if (
    judgment.tool === "venue_heritage" && !overlays.venueName &&
    regex.length === 1 && regex[0].name === "search_venues"
  ) return regex;
  const matching = regex.find((call) => call.name === judgment.tool);
  const primary = matching
    ? applyOverlays(matching, overlays)
    : defaultCall(judgment.tool, query, overlays);

  if (
    judgment.tool === "propose_map_action" &&
    judgment.wantsMap < ASK_ROUTER_WANTS_MAP_FLOOR
  ) {
    // Tool still wins; wantsMap is confirmation, not a veto.
    return [primary];
  }
  return [primary];
}

/**
 * TypeSafe Ask routing. Regex cascade is the keyless fallback and the source
 * of the fixture set. Never throws: timeout or a malformed answer drops to
 * regex with a drop reason in the TypeSafe timing line.
 */
export async function routeAsk(
  query: string,
  context: AskRouterContext = {},
): Promise<AskRouteResult> {
  const text = query.trim();
  if (!text) return { calls: [], source: "regex" };

  const venues = findAskVenueCandidates(text, context);
  const areas = findAskAreaCandidates(text);
  const questions = buildAskRouterQuestions(venues, areas);
  const outcome = await systemOneOutcome(
    {
      query: text,
      venues: venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        area: venue.area,
      })),
      areas: areas.map((area) => ({ id: area.id, name: area.name })),
    },
    questions,
    { lane: "typesafe", timeoutMs: 4_000 },
  );

  if (outcome.status !== "ok") {
    return regexResult(text, dropFromOutcome(outcome));
  }

  const judgment = parseAskRouterJudgment(outcome.result.answers);
  if (!judgment) return fallbackAfterOk(text, "malformed-answer");
  if (judgment.tool === ASK_ROUTER_NONE) return fallbackAfterOk(text, "chose-none");
  if (!judgedToolClearsFloor(judgment)) return fallbackAfterOk(text, "below-floor");

  return {
    calls: callsFromJudgment(text, judgment, venues, areas),
    source: "judged",
  };
}
