// The Pub Pal tools, as both providers offer them to the model. The ElevenLabs
// agent script (scripts/pubpal/create-elevenlabs-agent.mjs) wraps each one as a
// webhook with a conversation id; the Claude typed chat
// (lib/palClaudeChat.server.ts) sends the same names, descriptions and
// arguments as tool definitions. One list, so the two cannot drift apart.

import { PUB_PAL_MEMORY_KINDS } from "./palMemoryKinds.mjs";

/** Short descriptions aligned with lib/ask/tools.ts allowlist, plus the Pal-only memory tools. */
export const PUB_PAL_TOOL_DESCRIPTIONS = Object.freeze({
  search_venues:
    "Find one to six listed pubs by mood, area, group size, and budget. Pass the requested result count as limit. Never invent venues.",
  whats_on:
    "Look up sourced What's On listings (quiz, sport, deals) for tonight or a weekday.",
  venue_heritage:
    "Retrieve on-record heritage facts for a named listed pub. Never invents history.",
  venue_prices:
    "Read listed and corroborated people-logged prices for a pub. Never invents figures.",
  city_status: "London live weather, tube, and city signals via CityMCP.",
  journey: "Transit journey between two points or listed pubs via CityMCP.",
  area_buzz: "Borough pint average and things to do tonight via CityMCP.",
  propose_plan:
    "Propose a three-stop draft from listed pubs. Saves nothing until the reader confirms in the app.",
  propose_map_action:
    "Propose opening a pub sheet or flying the map. User must confirm before anything moves.",
  cheapest_pint_near:
    "Cheapest listed pints around a named pub or London area. Never uses the reader's GPS.",
  tonight_now:
    "Use only for explicit questions about sourced events or listings running now, tonight, or later, or how busy a pub or area is. Do not use for greetings or message labels. For crowd questions, explain that no live crowd reading exists. Never claim live crowd levels.",
  venue_drinks:
    "Every drink logged at one listed pub with provenance. Never invents figures.",
  find_desk:
    "Places to sit and work from cafe, co-working and library rows only.",
  report_occupancy:
    "Propose a crowd report for a pub. Writes nothing until the reader confirms.",
  recall_memories:
    "On the first substantive request, read confirmed preferences and past-night reports before a factual tool unless the message already supplies them. Do not use for greetings or thanks alone. Read-only. Never facts about a pub.",
  propose_memory:
    "Propose one lasting preference or explicitly reported past-night outcome for the Pal to remember in typed or voice chat. Saves nothing until the person confirms the card in the app.",
});

/** The arguments of the tools that do not take the default `query` alone. */
const TOOL_ARGUMENT_PROPERTIES = Object.freeze({
  cheapest_pint_near: {
    query: {
      type: "string",
      description: "The user's full question when area or pub name are unclear.",
    },
    area: { type: "string", description: "London area or neighbourhood, e.g. Soho or Camden." },
    venueName: { type: "string", description: "Named pub to search around." },
  },
  propose_plan: {
    query: {
      type: "string",
      description: "The full crawl or plan ask, including area and stop count.",
    },
  },
  search_venues: {
    query: { type: "string", description: "The venue search ask." },
    limit: { type: "number", description: "Number of pub recommendations requested, from 1 to 6. This is not the number of people. Use 4 when no result count is requested." },
  },
  recall_memories: {},
  propose_memory: {
    kind: {
      type: "string",
      enum: [...PUB_PAL_MEMORY_KINDS],
      description: "The preference kind, or night_outcome for an explicit past-night report.",
    },
    value: {
      type: "string",
      description: "The preference or past-night report in the person's own words, one short line. Preserve any stated pub, date and spend. Never infer expenditure from a price observation.",
    },
  },
});

const DEFAULT_ARGUMENT_PROPERTIES = Object.freeze({
  query: {
    type: "string",
    description: "The user's question this tool call should answer.",
  },
});

/** Every Pub Pal tool name, in the order the agent lists them. */
export const PUB_PAL_TOOL_NAMES = Object.freeze(Object.keys(PUB_PAL_TOOL_DESCRIPTIONS));

/** The JSON Schema properties a tool takes, without any provider's correlation field. */
export function pubPalToolArgumentProperties(name) {
  return TOOL_ARGUMENT_PROPERTIES[name] ?? DEFAULT_ARGUMENT_PROPERTIES;
}
