// The map tools a live voice call may use. They run in the browser, not on the
// server: they only move the view (camera, picks, highlight, browse-only sheet),
// so they need no Confirm tap (ADR 0014, amended for live voice calls). The
// agent script (scripts/pubpal/create-elevenlabs-agent.mjs) registers them as
// ElevenLabs client tools, and the voice session (components/pubpal) answers
// them. Typed chat has no live map, so they are not in lib/pubPalToolCatalog.mjs.

const pickNumber = {
  type: "integer",
  description: "The number on the pick from your newest answer on the map, starting at 1.",
};

export const PAL_MAP_CLIENT_TOOLS = Object.freeze([
  {
    name: "map_open",
    description: "Open the map in the app. Use when the person asks to see the map.",
    parameters: {},
  },
  {
    name: "map_focus_pick",
    description:
      "Highlight one numbered pick from your newest answer and move the map to it. Use for the first one, the second one, next or back.",
    parameters: { number: pickNumber },
  },
  {
    name: "map_open_pick_sheet",
    description: "Open the pub page of one numbered pick from your newest answer. Use when the person asks to open it or see its page.",
    parameters: { number: pickNumber },
  },
  {
    name: "map_fly_to_area",
    description: "Move the map to a London area, such as Soho, Camden or Peckham. It shows no pubs and states no facts.",
    parameters: {
      area: { type: "string", description: "The London area name the person said, such as Soho or King's Cross." },
    },
  },
  {
    name: "map_clear",
    description: "Take your picks off the map. Use when the person asks to clear the map.",
    parameters: {},
  },
].map((tool) => Object.freeze(tool)));

export const PAL_MAP_CLIENT_TOOL_NAMES = Object.freeze(PAL_MAP_CLIENT_TOOLS.map((tool) => tool.name));
