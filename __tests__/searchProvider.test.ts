import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SEARCH_GATEWAY_MODEL,
  SearchProviderBudgetError,
  createSearchProvider,
  type SearchProviderDependencies,
} from "@/lib/searchProvider.server";

const officialResult = {
  title: "Independent Arms drinks menu",
  url: "https://independentarms.co.uk/drinks",
  highlights: ["House Bitter - Pint £4.50"],
  publishedDate: "2026-08-01T00:00:00.000Z",
};

function gatewayDependencies(
  generateText: SearchProviderDependencies["generateText"],
): SearchProviderDependencies {
  return {
    generateText,
    gateway: {
      tools: {
        exaSearch: vi.fn((options: Record<string, unknown>) => ({
          kind: "exa-search-tool",
          options,
        })),
      },
    },
  } as SearchProviderDependencies;
}

function tavilyResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: [{
        title: "Independent Arms menu",
        url: "https://independentarms.co.uk/menu",
        content: "House Bitter - Pint £4.50",
      }],
      usage: { credits: 1 },
      ...overrides,
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search provider selection", () => {
  it("selects Tavily when SEARCH_PROVIDER is tavily", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const generateText = vi.fn();
    const provider = createSearchProvider({
      env: {
        SEARCH_PROVIDER: "tavily",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(generateText),
    });

    const result = await provider.search({ query: "official menu" });

    expect(provider.name).toBe("tavily");
    expect(result.results[0]).toMatchObject({
      url: "https://independentarms.co.uk/menu",
      content: "House Bitter - Pint £4.50",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("defaults to Exa and uses gateway tool results", async () => {
    const generateText = vi.fn(async (options: Record<string, unknown>) => {
      expect(options.model).toBe(SEARCH_GATEWAY_MODEL);
      expect(options.toolChoice).toEqual({ type: "tool", toolName: "exa_search" });
      return {
        steps: [{
          toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }],
        }],
        usage: { inputTokens: 20, outputTokens: 8 },
      };
    });
    const dependencies = gatewayDependencies(generateText);
    const provider = createSearchProvider({
      env: { AI_GATEWAY_API_KEY: "gateway-test-key" },
      dependencies,
    });

    const result = await provider.search({
      query: 'site:independentarms.co.uk "Independent Arms"',
      includeDomains: ["independentarms.co.uk"],
      startPublishedDate: "2026-07-01T00:00:00.000Z",
      endPublishedDate: "2026-08-14T00:00:00.000Z",
      maxResults: 5,
    });

    expect(provider.name).toBe("exa");
    expect(result.results).toEqual([{
      title: officialResult.title,
      url: officialResult.url,
      content: "House Bitter - Pint £4.50",
      publishedDate: officialResult.publishedDate,
    }]);
    expect(dependencies.gateway.tools.exaSearch).toHaveBeenCalledWith({
      type: "fast",
      numResults: 5,
      includeDomains: ["independentarms.co.uk"],
      startPublishedDate: "2026-07-01T00:00:00.000Z",
      endPublishedDate: "2026-08-14T00:00:00.000Z",
      contents: {
        highlights: { query: 'site:independentarms.co.uk "Independent Arms"', maxCharacters: 1600 },
        maxAgeHours: 24,
      },
    });
  });
});

describe("search provider fallback", () => {
  it("falls back to Tavily when the gateway credential is absent", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createSearchProvider({
      env: { SEARCH_PROVIDER: "exa", TAVILY_API_KEY: "tavily-test-key" },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn()),
    });

    const result = await provider.search({ query: "official menu" });

    expect(result.results).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("AI_GATEWAY_API_KEY"));
  });

  it("falls back to Tavily when an Exa request fails", async () => {
    const fetchImpl = vi.fn(async () => tavilyResponse());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createSearchProvider({
      env: {
        SEARCH_PROVIDER: "exa",
        AI_GATEWAY_API_KEY: "gateway-test-key",
        TAVILY_API_KEY: "tavily-test-key",
      },
      fetchImpl,
      dependencies: gatewayDependencies(vi.fn(async () => {
        throw new Error("gateway unavailable");
      })),
    });

    const result = await provider.search({ query: "official menu" });

    expect(result.results[0].url).toBe("https://independentarms.co.uk/menu");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to tavily"));
  });
});

describe("gateway spend guard", () => {
  it("stops before a call would exceed the configured per-run cap", async () => {
    const generateText = vi.fn(async () => ({
      steps: [{ toolResults: [{ toolName: "exa_search", output: { results: [officialResult] } }] }],
      usage: { inputTokens: 2, outputTokens: 3 },
    }));
    const provider = createSearchProvider({
      env: {
        AI_GATEWAY_API_KEY: "gateway-test-key",
        SEARCH_GATEWAY_MAX_CALLS: "1",
      },
      dependencies: gatewayDependencies(generateText),
    });

    await provider.search({ query: "first" });
    await expect(provider.search({ query: "second" })).rejects.toBeInstanceOf(SearchProviderBudgetError);

    expect(generateText).toHaveBeenCalledOnce();
    expect(provider.stats()).toMatchObject({
      gatewayCalls: 1,
      model: SEARCH_GATEWAY_MODEL,
    });
    expect(provider.stats().estimatedTokens).toBeGreaterThan(0);
  });
});
