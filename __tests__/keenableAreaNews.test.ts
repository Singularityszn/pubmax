import { describe, expect, it, vi } from "vitest";

import {
  areaNewsExtractPrompt,
  buildAreaNewsEntry,
  fetchKeenable,
  parseExtractedFact,
  searchKeenable,
} from "../scripts/lib/keenableAreaNews.mjs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FACT = {
  area: "soho",
  kind: "opening",
  title: "The White Hart opens in Soho",
  detail: "The White Hart opened in Soho on 27 August 2026.",
};

describe("Keenable area-news client", () => {
  it("uses the keyless public search endpoint when no API key is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs", results: [] }));

    await expect(
      searchKeenable("pubs", { env: {}, fetchImpl, maxResults: 4 }),
    ).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.keenable.ai/v1/search/public",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Keenable-Title": "PUBMAXX area news refresh",
        }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      query: "pubs",
      max_results: 4,
    });
  });

  it("uses the keyed endpoint when KEENABLE_API_KEY is present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs", results: [] }));

    await searchKeenable("pubs", {
      env: { KEENABLE_API_KEY: "keen_test" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.keenable.ai/v1/search",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "keen_test" }),
      }),
    );
  });

  it("fails loudly on an HTTP error or malformed response", async () => {
    const failedFetch = vi.fn().mockResolvedValue(jsonResponse({ error: "quota" }, 402));
    await expect(searchKeenable("pubs", { env: {}, fetchImpl: failedFetch })).rejects.toThrow(
      "Keenable search returned 402",
    );

    const malformedFetch = vi.fn().mockResolvedValue(jsonResponse({ query: "pubs" }));
    await expect(searchKeenable("pubs", { env: {}, fetchImpl: malformedFetch })).rejects.toThrow(
      "Keenable search response did not contain results",
    );
  });

  it("fetches a page and fails loudly when content is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        url: "https://example.com/article",
        title: "Article",
        content: "# Article\n\nA real page.",
        published_at: 1_787_000_000,
      }),
    );

    await expect(
      fetchKeenable("https://example.com/article", { env: {}, fetchImpl }),
    ).resolves.toMatchObject({ content: "# Article\n\nA real page." });
    expect(fetchImpl.mock.calls[0][0]).toContain("/v1/fetch/public?url=");

    const emptyFetch = vi.fn().mockResolvedValue(jsonResponse({ content: "" }));
    await expect(fetchKeenable("https://example.com/article", { env: {}, fetchImpl: emptyFetch })).rejects.toThrow(
      "Keenable fetch response did not contain content",
    );
  });
});

describe("Keenable area-news extraction", () => {
  it("parses plain or fenced JSON and rejects non-facts", () => {
    const options = { currentYear: 2026 };
    expect(parseExtractedFact({ content: `\`\`\`json\n${JSON.stringify(FACT)}\n\`\`\`` }, options)).toEqual(FACT);
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, area: "wimbledon" }) }, options)).toMatchObject({ area: "wimbledon" });
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, area: "greenwich" }) }, options)).toMatchObject({ area: "greenwich" });
    expect(parseExtractedFact({ content: "null" })).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, area: "Leeds" }) }, options)).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, title: "A — bad title" }) }, options)).toBeNull();
  });

  it("rejects historical or unnamed JSON facts even when the page is recent", () => {
    const options = { knownAreas: new Set(["soho"]), currentYear: 2026 };
    expect(
      parseExtractedFact(
        {
          content: JSON.stringify({
            ...FACT,
            title: "Soho pub award in 2024",
            detail: "The pub won an award in 2024.",
          }),
        },
        options,
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: JSON.stringify({
            ...FACT,
            title: "Soho Pub News August 2026",
            detail: "A pub opening was reported in August 2026.",
          }),
        },
        options,
      ),
    ).toBeNull();
    expect(
      buildAreaNewsEntry({
        result: { url: "https://example.com/article", published_at: "2026-08-27T12:00:00Z" },
        page: { url: "https://example.com/article", published_at: "2026-08-27T12:00:00Z" },
        fact: { ...FACT, title: "Soho pub award in 2024", detail: "The pub won an award in 2024." },
        now: Date.parse("2026-08-28T12:00:00Z"),
        knownAreas: new Set(["soho"]),
      }),
    ).toBeNull();
  });

  it("extracts a dated fact from clean fetched markdown", () => {
    expect(
      parseExtractedFact(
        {
          content:
            "# The White Hart reopens in Soho\n\nThe White Hart reopened in Soho on 27 August 2026 after a refurbishment.",
        },
        { knownAreas: new Set(["soho"]) },
      ),
    ).toEqual({
      area: "soho",
      kind: "opening",
      title: "The White Hart reopens in Soho",
      detail: "The White Hart reopened in Soho on 27 August 2026 after a refurbishment.",
    });
  });

  it("rejects historical and generic markdown pages", () => {
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2024\n\nThe pub won an award in 2024.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026 },
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2026\n\nThe pub won an award in 2026.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026 },
      ),
    ).toBeNull();
  });

  it("generates extraction instructions for refresh year", () => {
    expect(areaNewsExtractPrompt(2027)).toContain("current 2027 event");
  });

  it("builds a dated, https, source-attributed entry from a fetched page", () => {
    const entry = buildAreaNewsEntry({
      result: {
        url: "https://example.com/article",
        title: "Article",
        published_at: "2026-08-27T12:00:00Z",
      },
      page: {
        url: "https://example.com/article/",
        content: "source",
        published_at: 1787822400,
      },
      fact: FACT,
      now: Date.parse("2026-08-28T12:00:00Z"),
      knownAreas: new Set(["soho"]),
    });

    expect(entry).toMatchObject({
      id: expect.stringMatching(/^area-news-/),
      area: "soho",
      sourceUrl: "https://example.com/article/",
      sourceName: "example.com",
      observedAt: "2026-08-27",
    });
  });
});
