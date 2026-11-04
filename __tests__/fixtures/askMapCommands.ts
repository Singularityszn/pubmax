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
  "Open the full map for tonight", "Show me the map for right now",
  "Map for now", "View the whole map for later", "Open the map for today",
  "Show the map for this evening", "Open the map for this afternoon",
  "View the map for this morning", "Open the full map for this weekend",
];

export const SOCIAL_MAP_COMMANDS = [
  "Hi show me the map", "OK show me the map", "Okay show me the map",
  "Alright show me the map", "Hey can you show me the map",
];

export const REFUSED_MAP_COMMANDS = [
  "Next. Stop.", "Next, stop.", "Next‑stop please. Please stop.",
  "Map, not yet", "Map. Not yet.", "Show me the map, not yet",
  "Open the map. Not yet.", "Show me the map, hold off",
  "Do not show me the map", "Show me the map for the next stop. Not yet.",
  "Hold off show me the map", "Map. Stop.",
  "Show me the map. Please stop.", "Next stop. Please stop.",
  "Show me the map, please stop.", "Next stop, please stop.",
  "Show me the map. Could you please stop.", "Next stop. Could you please stop.",
  "Next stop please. Please stop.", "What's next tonight? Please stop.",
  "Show me the map. Actually, stop.",
  "Show me the map for the next stop please. Actually, stop.",
  "Show those pubs on the map. Actually, stop.",
  "Show The Harp on the map. Actually, stop.",
  "Please stop. Next stop please.", "Actually, stop. Show me the map.",
];

export function serviceBesideMap(service: string, map = "Open the map"): string[] {
  const evidence = "Show the source and date for any price you use.";
  return [`${service}. ${map}.`, `${map}. ${service}.`].flatMap((query) => [
    query, `${evidence} ${query}`, `${query} ${evidence}`,
  ]);
}

export const GROUP_MAP_REQUESTS = [
  "Find pubs in Soho. Open the map for 8",
  "Find pubs in Soho for 8. Open the map",
  "Open the full map for 8. Find quiet pubs in Soho under £7 a pint",
  "Find quiet pubs in Soho under £7 a pint. View the whole map for 8",
].flatMap((query) => [
  query,
  `Show the source and date for any price you use. ${query}`,
  `${query}. Show the source and date for any price you use.`,
]);

export const NEXT_STOP_NOUN_REQUESTS = [
  "Next stop please", "Next-stop please", "Next‐stop please", "Next‑stop please",
  "Next–stop please", "Next stop. Next‑stop please.",
];

export function priceMapMetadataRequests(service: string): string[] {
  const metadata = "Show the map for any price you use";
  return [
    `${metadata}. ${service}`,
    `${service.replace(/[.!?]+$/, "")}.${metadata}.`,
    `${service.replace(/[.!?]+$/, "")}. ${metadata}.`,
  ];
}
