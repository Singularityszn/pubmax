import { describe, expect, it, vi } from "vitest";

import {
  PROVIDER_POLICY,
  discoverRefreshPages,
  fetchRefreshPage,
  fetchTinyfishPage,
  providerForJob,
} from "../scripts/lib/localRefreshProviders.mjs";

describe("local refresh provider policy", () => {
  it("assigns one explicit provider and credential to each acquisition job", () => {
    expect(PROVIDER_POLICY).toEqual({
      "pub-discovery": { provider: "exa", key: "EXA_API_KEY" },
      "rendered-menu": { provider: "browserbase", key: "BROWSERBASE_API_KEY" },
      "plain-page": { provider: "tavily", key: "TAVILY_API_KEY" },
    });
    expect(providerForJob("pub-discovery")).toEqual(PROVIDER_POLICY["pub-discovery"]);
  });

  it("names provider and credential when a key is absent", async () => {
    await expect(
      discoverRefreshPages({ query: "new London pub", environment: {} }),
    ).rejects.toMatchObject({
      provider: "exa",
      message: "exa unavailable: missing EXA_API_KEY",
    });
  });

  it("fails loudly when a provider refuses a credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        statusText: "Payment Required",
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      provider: "tavily",
      status: 402,
      message: "tavily refused request: HTTP 402 Payment Required",
    });
  });
});

describe("local refresh provider response contracts", () => {
  it("normalises Exa discovery without changing result meaning", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            url: "https://example.com/new-pub/menu",
            title: "New Pub drinks",
            text: "Official menu page",
          },
        ],
      }),
    );

    await expect(
      discoverRefreshPages({
        query: "new London pubs official menu",
        includeDomains: ["example.com"],
        environment: { EXA_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).resolves.toEqual([
      {
        url: "https://example.com/new-pub/menu",
        title: "New Pub drinks",
        text: "Official menu page",
      },
    ]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "secret-value" }),
      }),
    );
  });

  it("returns Tavily markdown and links in existing scraper shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            url: "https://example.com/menu",
            raw_content: "## Drinks\n\n[Beer list](https://example.com/drinks)",
          },
        ],
        failed_results: [],
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).resolves.toEqual({
      markdown: "## Drinks\n\n[Beer list](https://example.com/drinks)",
      links: ["https://example.com/drinks"],
      finalUrl: "https://example.com/menu",
    });
  });

  it("returns Browserbase rendered content through the same page shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "session-1", connectUrl: "wss://browser.example/session" }), {
        status: 201,
      }),
    );
    const renderBrowserPage = vi.fn().mockResolvedValue({
      markdown: "### Draught Beer\n\n#### Lager\n\n£6.20",
      links: ["https://example.com/drinks"],
      finalUrl: "https://example.com/menu",
    });

    await expect(
      fetchRefreshPage({
        job: "rendered-menu",
        url: "https://example.com/menu",
        environment: { BROWSERBASE_API_KEY: "secret-value" },
        fetchImpl,
        renderBrowserPage,
      }),
    ).resolves.toEqual({
      markdown: "### Draught Beer\n\n#### Lager\n\n£6.20",
      links: ["https://example.com/drinks"],
      finalUrl: "https://example.com/menu",
    });
    expect(renderBrowserPage).toHaveBeenCalledWith(
      "wss://browser.example/session",
      "https://example.com/menu",
    );
  });

  it.each([
    {
      job: "plain-page" as const,
      environment: { TAVILY_API_KEY: "secret-value" },
      provider: "tavily",
      fetchImpl: vi.fn().mockResolvedValue(
        Response.json({
          results: [{ raw_content: "## Drinks\n\nLager £6.20" }],
          failed_results: [],
        }),
      ),
      renderBrowserPage: undefined,
    },
    {
      job: "rendered-menu" as const,
      environment: { BROWSERBASE_API_KEY: "secret-value" },
      provider: "browserbase",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ connectUrl: "wss://browser.example/session" }), {
          status: 201,
        }),
      ),
      renderBrowserPage: vi.fn().mockResolvedValue({
        markdown: "## Drinks\n\nLager £6.20",
        links: [],
      }),
    },
  ])("fails closed when $provider omits the resolved final URL", async (fixture) => {
    await expect(
      fetchRefreshPage({
        job: fixture.job,
        url: "https://example.com/menu",
        environment: fixture.environment,
        fetchImpl: fixture.fetchImpl,
        ...(fixture.renderBrowserPage
          ? { renderBrowserPage: fixture.renderBrowserPage }
          : {}),
      }),
    ).rejects.toMatchObject({
      provider: fixture.provider,
      message: `${fixture.provider} returned no resolved final URL for https://example.com/menu`,
    });
  });

  it("does not turn an empty or failed extraction into an honest zero-row page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        results: [],
        failed_results: [{ url: "https://example.com/menu", error: "blocked" }],
      }),
    );

    await expect(
      fetchRefreshPage({
        job: "plain-page",
        url: "https://example.com/menu",
        environment: { TAVILY_API_KEY: "secret-value" },
        fetchImpl,
      }),
    ).rejects.toThrow("tavily could not extract https://example.com/menu: blocked");
  });
});

describe("TinyFish fetch", () => {
  const answer = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  it("returns the rendered page, its links and where it landed", async () => {
    const page = await fetchTinyfishPage({
      url: "https://pub.example/drinks",
      environment: { TINYFISH_API_KEY: "key" },
      fetchImpl: answer({ results: [{ url: "https://pub.example/drinks", final_url: "https://pub.example/drinks/", text: "Guinness £6", links: ["https://pub.example/wine"] }], errors: [] }),
    });
    expect(page).toEqual({ markdown: "Guinness £6", links: ["https://pub.example/wine"], finalUrl: "https://pub.example/drinks/", via: "tinyfish" });
  });

  it("names a bot block or a 403 as a refusal and a timeout as a plain failure", async () => {
    const fetchWith = (error: Record<string, unknown>) => fetchTinyfishPage({
      url: "https://pub.example/drinks",
      environment: { TINYFISH_API_KEY: "key" },
      fetchImpl: answer({ results: [], errors: [{ url: "https://pub.example/drinks", ...error }] }),
    });
    await expect(fetchWith({ error: "bot_blocked" })).rejects.toMatchObject({ refusal: "blocked-by-challenge" });
    await expect(fetchWith({ error: "target_http_error", status: 403 })).rejects.toMatchObject({ refusal: "refused-by-site" });
    const timeout = await fetchWith({ error: "timeout" }).catch((error: unknown) => error);
    expect(timeout).toMatchObject({ provider: "tinyfish" });
    expect((timeout as { refusal?: string }).refusal).toBeUndefined();
  });

  it("refuses to run without its key", async () => {
    await expect(fetchTinyfishPage({ url: "https://pub.example/", environment: {} })).rejects.toMatchObject({ provider: "tinyfish" });
  });
});
