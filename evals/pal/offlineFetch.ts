const CITYMCP_EMPTY_RESULTS: Record<string, unknown> = {
  get_journey: { journeys: [] },
  things_to_do: { window: "tonight", opportunities: [] },
};

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function cityMcpToolName(url: string, init: RequestInit | undefined): string | null {
  if (new URL(url).hostname !== "citymcp.com" || typeof init?.body !== "string") return null;
  const payload = JSON.parse(init.body) as { params?: { name?: unknown } };
  return typeof payload.params?.name === "string" ? payload.params.name : null;
}

/**
 * The offline CityMCP the Ask tests and the Pal eval share: journeys and
 * things to do answer empty, every other tool and every other URL is down.
 */
export const offlineFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const tool = cityMcpToolName(url, init);
  const structuredContent = tool ? CITYMCP_EMPTY_RESULTS[tool] : undefined;
  if (!structuredContent) {
    throw new Error(`Offline: refused ${tool ? `CityMCP ${tool}` : url}.`);
  }
  return new Response(JSON.stringify({ jsonrpc: "2.0", result: { structuredContent } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
