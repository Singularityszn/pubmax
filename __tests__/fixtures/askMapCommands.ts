export const GENERIC_MAP_COMMANDS = [
  "Open the map", "Show the map please", "See the map", "View the map",
  "Pull up the map", "Bring up the map", "Load the map", "Display the map",
  "Go to the map", "Go back to the map", "Back to the map", "Take me to the map",
  "Take me back to the map", "Switch to the map", "Get me the map",
  "Give me the map", "Let me see the map", "Can you open up the pub map",
  "The map please", "Map view", "Show me the maps now",
  "Show the map, please", "Open the map for me", "Open the map, mate",
  "Open the full map", "Show me the full map", "Open the full map tonight",
  "View the whole map please", "Can you open up the whole pub map",
  "Pull up the full map, please", "The full map please", "Whole map view",
];

export const SOCIAL_MAP_COMMANDS = [
  "Hi show me the map", "OK show me the map", "Okay show me the map",
  "Alright show me the map", "Hey can you show me the map",
];

export const REFUSED_MAP_COMMANDS = [
  "Map, not yet", "Map. Not yet.", "Show me the map, not yet",
  "Open the map. Not yet.", "Show me the map, hold off",
  "Do not show me the map", "Show me the map for the next stop. Not yet.",
  "Hold off show me the map", "Map. Stop.",
  "Show me the map. Please stop.", "Next stop. Please stop.",
  "Show me the map, please stop.", "Next stop, please stop.",
  "Show me the map. Could you please stop.", "Next stop. Could you please stop.",
];

export function serviceBesideMap(service: string, map = "Open the map"): string[] {
  const evidence = "Show the source and date for any price you use.";
  return [`${service}. ${map}.`, `${map}. ${service}.`].flatMap((query) => [
    query, `${evidence} ${query}`, `${query} ${evidence}`,
  ]);
}
