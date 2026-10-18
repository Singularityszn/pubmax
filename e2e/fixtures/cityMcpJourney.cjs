// Preloaded only by the keyless browser server, never by the application.
// These are disposable service data, not evidence of live transit availability.
const originalFetch = globalThis.fetch;
const durationsByOrigin = new Map([
  ["51.50500,-0.08600", 12], // London Bridge, the default origin.
  ["51.53000,-0.12400", 18], // Kings Cross.
  ["51.45690,-0.01438", 42], // Fox and Firkin.
]);

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== "https://citymcp.com/london/mcp") return originalFetch(input, init);
  const request = new Request(input, init);
  const payload = await request.clone().json();
  if (payload.method !== "tools/call" || payload.params?.name !== "get_journey") {
    return originalFetch(input, init);
  }
  const { from, to } = payload.params.arguments;
  const durationMinutes = durationsByOrigin.get(from);
  return Response.json({
    jsonrpc: "2.0",
    id: payload.id,
    result: {
      structuredContent: {
        journeys: to === "51.52042,-0.10071" && durationMinutes !== undefined
          ? [{ durationMinutes, legs: [] }]
          : [],
      },
    },
  });
};
