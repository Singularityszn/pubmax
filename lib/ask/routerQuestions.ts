import { choice, noul, type Questions } from "@typesafe-ai/sdk";

import type { AskAreaCandidate, AskVenueCandidate } from "@/lib/ask/routerCandidates";
import { ASK_ROUTER_NONE } from "@/lib/ask/routerPolicy";

const TOOL_CRITERIA: Record<string, { what: string; not_for: string; examples: string[] }> = {
  search_venues: {
    what: "A general pub search by mood, vibe, garden, or place, with no specialised intent",
    not_for: "Prices, heritage, crawls, listings kinds, desks, or crowd reports",
    examples: ["Quiet-ish near Bank, 4 of us", "Quiet garden near Soho"],
  },
  whats_on: {
    what: "Quizzes, live music, sport screenings, or another named listings kind tonight",
    not_for: "A bare right-now ask with no kind, or a crawl plan",
    examples: ["Quiz tonight in Soho", "Any live music on right now in Dalston"],
  },
  venue_heritage: {
    what: "History, a listed building, who built it, or the story of a named pub",
    not_for: "Pint prices or a map fly-to",
    examples: ["Tell me the history of The Lamb", "When was The Lamb built"],
  },
  venue_prices: {
    what: "How much a pint or drink costs at one named pub, including dearest or at-this-pub cheapest",
    not_for: "Cheapest pint in an area or around a pub, or a drinks-list ask",
    examples: ["how much is a pint at The Lamb", "cheapest pint at The Lamb", "dearest pint in Soho"],
  },
  city_status: {
    what: "Tube, delays, weather, or how London is right now as a city",
    not_for: "How busy a neighbourhood's pubs are",
    examples: ["Any tube delays right now?", "How's London right now"],
  },
  journey: {
    what: "How to get somewhere, directions, or a route to a place",
    not_for: "A crawl plan or a map fly-to",
    examples: ["How do I get to The Lamb", "Directions to The Crown"],
  },
  area_buzz: {
    what: "What an area is like, the average pint there, or things to do in a neighbourhood",
    not_for: "A named pub's own price or a listings kind",
    examples: ["Average pint in Camden", "What's it like in Shoreditch"],
  },
  propose_plan: {
    what: "Plan a crawl, a three-stop night, or sort a night out",
    not_for: "A single cheapest-pint list",
    examples: ["Plan a crawl in Soho for 4", "Three-stop crawl in Soho"],
  },
  propose_map_action: {
    what: "Open, show, fly to, or take the reader to a pub on the map",
    not_for: "Directions by public transport",
    examples: ["Open The Lamb on the map", "Fly to The Lamb"],
  },
  cheapest_pint_near: {
    what: "The cheapest or cheap pint in an area or around a pub, not the price at one named pub",
    not_for: "Cheapest pint at a named pub, a dearest ask, or a cheap crawl",
    examples: ["Cheapest pint in Camden", "cheapest pint near The Lamb"],
  },
  tonight_now: {
    what: "What is on right now, happening now, or how busy, with no named listings kind",
    not_for: "Tube or weather, or a quiz/music kind",
    examples: ["What is on right now in Shoreditch", "How busy in Soho"],
  },
  venue_drinks: {
    what: "The drinks list, what they pour or serve, or what's on tap at one named pub",
    not_for: "Drink prices in an area with no named pub",
    examples: ["What's on tap at The Lamb", "What do they pour at The Lamb"],
  },
  find_desk: {
    what: "Somewhere to work, a laptop, wifi, a desk, or a plug socket, without asking for pubs or pints",
    not_for: "A pub or pint ask that happens to mention wifi",
    examples: ["Somewhere to work with wifi in Angel", "Co-working with wifi in Shoreditch"],
  },
  report_occupancy: {
    what: "A crowd report: rammed, packed, empty, full, no seats, or log how busy",
    not_for: "A quiet-pub ask, which is a venue search",
    examples: ["It's rammed in The Lamb", "No seats at The Lamb"],
  },
  none: {
    what: "A greeting, unrelated chat, or an ask too unclear to pick a tool",
    not_for: "Any ask that matches one of the tools above",
    examples: ["hello", "thanks"],
  },
};

const ASK_ROUTER_QUESTION_IDS = {
  tool: "tool",
  venue: "venue",
  area: "area",
  wantsMap: "wantsMap",
} as const;

function venueCriteria(
  venues: readonly AskVenueCandidate[],
): Record<string, { what: string; not_for: string }> {
  const criteria: Record<string, { what: string; not_for: string }> = {};
  for (const venue of venues) {
    criteria[venue.id] = {
      what: `${venue.name} in ${venue.area}`,
      not_for: "A different pub or a neighbourhood name",
    };
  }
  criteria[ASK_ROUTER_NONE] = {
    what: "No named pub in the ask, or none of the listed pubs is the one meant",
    not_for: "A clear mention of one of the listed pubs",
  };
  return criteria;
}

function areaCriteria(
  areas: readonly AskAreaCandidate[],
): Record<string, { what: string; not_for: string }> {
  const criteria: Record<string, { what: string; not_for: string }> = {};
  for (const area of areas) {
    if (area.id === ASK_ROUTER_NONE) {
      criteria[ASK_ROUTER_NONE] = {
        what: "No London neighbourhood or borough is named, or none of the listed areas is meant",
        not_for: "A clear mention of one of the listed areas",
      };
      continue;
    }
    criteria[area.id] = {
      what: `The ask is about ${area.name}`,
      not_for: "A different area, or a pub that only sits in this area",
    };
  }
  if (!(ASK_ROUTER_NONE in criteria)) {
    criteria[ASK_ROUTER_NONE] = {
      what: "No London neighbourhood or borough is named",
      not_for: "A clear mention of one of the listed areas",
    };
  }
  return criteria;
}

/** One request: tool Choice plus speculative venue, area, and wantsMap. */
export function buildAskRouterQuestions(
  venues: readonly AskVenueCandidate[],
  areas: readonly AskAreaCandidate[],
): Questions {
  return {
    [ASK_ROUTER_QUESTION_IDS.tool]: choice(
      {
        question: "Which Ask tool should answer `query`?",
        inspect: "query",
        focus:
          "Pick the specialised tool when its own precondition holds. A named What's-On kind beats a bare right-now ask. A pint at one named pub is venue_prices, not cheapest_pint_near.",
      },
      TOOL_CRITERIA,
    ),
    [ASK_ROUTER_QUESTION_IDS.venue]: choice(
      {
        question:
          "Which pub in `venues` does `query` name as the subject? Choose none if it names no pub, or none of these pubs.",
        inspect: "query",
        compare: ["query", "venues"],
      },
      venueCriteria(venues),
    ),
    [ASK_ROUTER_QUESTION_IDS.area]: choice(
      {
        question:
          "Which area in `areas` does `query` name as the place? Choose none if it names no area, or none of these areas.",
        inspect: "query",
        compare: ["query", "areas"],
      },
      areaCriteria(areas),
    ),
    [ASK_ROUTER_QUESTION_IDS.wantsMap]: noul(
      {
        question: "Does `query` ask to open, show, or fly to a place on the map?",
        inspect: "query",
        focus: "Count map-canvas asks, not directions by tube or a crawl plan.",
      },
      {
        true: {
          what: "The user wants the map to move or open a pub pin",
          examples: ["Open The Lamb on the map", "Fly to The Lamb", "Show me The George"],
        },
        false: {
          what: "Any other pub ask, including directions and crawls",
          examples: ["How do I get to The Lamb", "Quiz tonight in Soho"],
        },
      },
    ),
  };
}
