import { describe, expect, it, vi } from "vitest";
import { createRobotsChecker } from "../lib/harvest/robots";

const { lookupHost } = vi.hoisted(() => ({
  lookupHost: vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupHost }));

import {
  buildAreaNewsEntry,
  fetchKeenable,
  KNOWN_AREA_SLUGS,
  parseExtractedFact,
  searchKeenable,
} from "../scripts/lib/keenableAreaNews.mjs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testClientOptions(fetchImpl: unknown, signal?: AbortSignal) {
  return { env: {}, fetchImpl, signal, checkRobots: createRobotsChecker({ fetchImpl: fetchImpl as typeof fetch }) };
}

const FACT = {
  area: "soho",
  kind: "opening",
  title: "Golden Lion (Soho) opens in Soho",
  detail: "Golden Lion (Soho) pub opened in Soho on 27 August 2026.",
};

// A fact is only current inside a 21-day window ending at `now`, so every fixture
// dated 27 August 2026 must be judged against a pinned clock, never the wall clock.
const NOW = Date.parse("2026-08-28T12:00:00Z");

describe("Keenable area-news client", () => {
  it("uses the public-address transport for its default robots checker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: "A page" }));
    await expect(fetchKeenable("https://attacker-controlled.example/news", { env: {}, fetchImpl })).rejects.toThrow(/robots/i);
    expect(lookupHost).toHaveBeenCalledWith("attacker-controlled.example", { all: true, verbatim: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.nicholsonspubs.co.uk/news",
    "https://localhost/news",
    "https://user:password@example.com/news",
  ])("refuses prohibited source %s before any network call", async (sourceUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ content: "A page" }));
    await expect(fetchKeenable(sourceUrl, testClientOptions(fetchImpl))).rejects.toThrow(/source policy/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([200, 503])("does not send a refused or unreadable robots source to the provider (%s)", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("User-agent: *\nDisallow: /", { status }));
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl))).rejects.toThrow(/robots/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.com/robots.txt");
  });

  it("rejects a provider landing on a prohibited source", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /")
      : jsonResponse({ url: "https://www.nicholsonspubs.co.uk/news", content: "A page" }));
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl))).rejects.toThrow(/source policy/i);
  });

  it("refuses a robots redirect to a prohibited source before asking the content provider", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response(null, { status: 302, headers: { location: "https://localhost/robots.txt" } });
      }
      return jsonResponse({ url: "https://example.com/news", content: "A page" });
    });
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl))).rejects.toThrow(/robots/i);
    expect(fetchImpl.mock.calls.every(([url]) => url === "https://example.com/robots.txt")).toBe(true);
  });

  it.each([undefined, null, "", 42])("refuses content without an explicit final source URL (%s)", async (url) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("User-agent: *\nAllow: /"))
      .mockResolvedValue(jsonResponse({ url, content: "A page" }));
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl))).rejects.toThrow(/final source URL/i);
  });

  it("checks robots for the provider's final page before accepting content", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/robots.txt") return new Response("User-agent: *\nAllow: /");
      if (url === "https://news.example.org/robots.txt") return new Response("User-agent: *\nDisallow: /");
      return jsonResponse({ url: "https://news.example.org/article", content: "A page" });
    });
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl))).rejects.toThrow(/robots/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not call the provider after cancellation during the permission check", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return new Response("User-agent: *\nAllow: /");
    });
    await expect(fetchKeenable("https://example.com/news", testClientOptions(fetchImpl, controller.signal))).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("User-agent: *\nAllow: /")).mockResolvedValue(
      jsonResponse({
        url: "https://example.com/article",
        title: "Article",
        content: "# Article\n\nA real page.",
        published_at: 1_787_000_000,
      }),
    );

    await expect(
      fetchKeenable("https://example.com/article", testClientOptions(fetchImpl)),
    ).resolves.toMatchObject({ content: "# Article\n\nA real page." });
    expect(fetchImpl.mock.calls[1][0]).toContain("/v1/fetch/public?url=");

    const emptyFetch = vi.fn().mockResolvedValueOnce(new Response("User-agent: *\nAllow: /")).mockResolvedValue(jsonResponse({ url: "https://example.com/article", content: "" }));
    await expect(fetchKeenable("https://example.com/article", testClientOptions(emptyFetch))).rejects.toThrow(
      "Keenable fetch response did not contain content",
    );
  });
});

describe("Keenable area-news extraction", () => {
  it("parses plain or fenced JSON and rejects non-facts", () => {
    const options = { currentYear: 2026, now: NOW };
    expect(KNOWN_AREA_SLUGS.has("hackney")).toBe(true);
    expect(parseExtractedFact({ content: `\`\`\`json\n${JSON.stringify(FACT)}\n\`\`\`` }, options)).toEqual(FACT);
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "wimbledon",
      title: "The Dog & Fox opens in Wimbledon",
      detail: "The Dog & Fox pub opened in Wimbledon on 27 August 2026.",
    }) }, options)).toMatchObject({ area: "wimbledon" });
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "greenwich",
      title: "The Valley opens in Greenwich",
      detail: "The Valley pub opened in Greenwich on 27 August 2026.",
    }) }, options)).toMatchObject({ area: "greenwich" });
    expect(parseExtractedFact({ content: "null" })).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, area: "Leeds" }) }, options)).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({ ...FACT, title: "A — bad title" }) }, options)).toBeNull();
  });

  it("rejects historical or unnamed JSON facts even when the page is recent", () => {
    const options = { knownAreas: new Set(["soho"]), currentYear: 2026, now: NOW };
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
            title: "John Smith said the pub opened in Soho",
            detail: "John Smith said the pub opened in Soho on 27 August 2026.",
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
        now: NOW,
        knownAreas: new Set(["soho"]),
      }),
    ).toBeNull();
  });

  it("extracts a dated fact from clean fetched markdown", () => {
    expect(
      parseExtractedFact(
        {
          content:
            "# Golden Lion (Soho) reopens in Soho\n\nGolden Lion (Soho) pub reopened in Soho on 27 August 2026 after a relaunch.",
        },
        { knownAreas: new Set(["soho"]), now: NOW },
      ),
    ).toEqual({
      area: "soho",
      kind: "opening",
      title: "Golden Lion (Soho) reopens in Soho",
      detail: "Golden Lion (Soho) pub reopened in Soho on 27 August 2026 after a relaunch.",
    });
  });

  it("classifies closing refurbishment pages as refurbishments", () => {
    expect(
      parseExtractedFact(
        {
          content:
            "# Golden Lion (Soho) pub is closing in Soho\n\nGolden Lion (Soho) pub closed for refurbishment on 27 August 2026 and will reopen on 22 October 2026.",
        },
        { knownAreas: new Set(["soho"]), now: NOW },
      ),
    ).toMatchObject({ area: "soho", kind: "refurb" });
  });

  it("accepts a prior-year fact during January rollover", () => {
    const fact = {
      ...FACT,
      title: "Golden Lion (Soho) reopens in Soho",
      detail: "Golden Lion (Soho) pub reopened in Soho on 31 December 2026.",
    };
    expect(parseExtractedFact({ content: JSON.stringify(fact) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toEqual(fact);
    expect(buildAreaNewsEntry({
      result: { url: "https://example.com/article", published_at: "2027-01-04T12:00:00Z" },
      page: { url: "https://example.com/article", published_at: "2027-01-04T12:00:00Z" },
      fact,
      now: Date.parse("2027-01-05T12:00:00Z"),
      knownAreas: new Set(["soho"]),
    })).not.toBeNull();

    expect(parseExtractedFact({ content: JSON.stringify({
      ...fact,
      detail: "Golden Lion (Soho) pub reopened in Soho on 1 January 2026.",
    }) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toBeNull();

    expect(parseExtractedFact({ content: JSON.stringify({
      ...fact,
      detail: "Golden Lion (Soho) pub reopened in Soho in December 2026.",
    }) }, {
      knownAreas: new Set(["soho"]),
      currentYear: 2027,
      now: Date.parse("2027-01-05T12:00:00Z"),
    })).toBeNull();
  });

  it("requires an exact current-year event date inside the rolling window", () => {
    const options = {
      knownAreas: new Set(["soho"]),
      currentYear: 2026,
      now: NOW,
    };

    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      detail: "Golden Lion (Soho) pub opened in Soho on 2 January 2026.",
    }) }, options)).toBeNull();
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      detail: "Golden Lion (Soho) pub opens in Soho on 29 August 2026.",
    }) }, options)).toBeNull();
  });

  it("rejects a known venue when its dataset borough does not match the fact area", () => {
    expect(parseExtractedFact({ content: JSON.stringify({
      ...FACT,
      area: "teddington",
      title: "The Old King's Head opens in Teddington",
      detail: "The Old King's Head pub opened in Teddington on 27 August 2026.",
    }) }, {
      currentYear: 2026,
      now: NOW,
    })).toBeNull();
  });

  it("rejects historical and generic markdown pages", () => {
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2024\n\nThe pub won an award in 2024.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026, now: NOW },
      ),
    ).toBeNull();
    expect(
      parseExtractedFact(
        {
          content: "# Soho pub award in 2026\n\nThe pub won an award in 2026.",
        },
        { knownAreas: new Set(["soho"]), currentYear: 2026, now: NOW },
      ),
    ).toBeNull();
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
      now: NOW,
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
