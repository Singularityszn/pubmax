import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_DEV_BATCH_MAX_URLS,
  batchSubmit,
  brandRetrieve,
  contextDevUrlRefusal,
  crawlMarkdown,
  scrapeHtml,
  scrapeMarkdown,
  searchWeb,
  sitemapUrls,
} from "@/lib/contextDev.server";
import type { RobotsChecker } from "@/lib/harvest/robots";

const KEY = { CONTEXT_DEV_API_KEY: "ctx-key" } as unknown as NodeJS.ProcessEnv;
const noSleep = async () => {};

/** A host the table records a permission for, so the gate needs no live check. */
const PERMITTED = "https://www.fullers.co.uk/event-finder";
/** A host lib/harvest/sourcePolicy.ts refuses outright. */
const REFUSED = "https://www.vintageinn.co.uk/pub/menu";
/** A host nobody has written an answer down for. */
const UNRECORDED = "https://www.some-free-house.co.uk/drinks";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function scrapeEnvelope(url: string) {
  return {
    success: true as const,
    url,
    finalDOMState: "loaded" as const,
    request_id: "test",
    cache_metadata: { age_ms: 0, status: "miss" as const },
    metadata: { finalUrl: url, sourceUrl: url },
  };
}

function scrapeOutput(format: "markdown" | "html", data: string | null, success = true) {
  if (!success || data === null) {
    return { success: false, url: PERMITTED, error_code: "EMPTY" };
  }
  const base = scrapeEnvelope(PERMITTED);
  return format === "markdown"
    ? { ...base, markdown: data, contentLength: data.length }
    : { ...base, html: data, type: "html" as const };
}

function allowRobots(): RobotsChecker {
  return async () => ({ allowed: true, reason: "allowed", evidence: "stub" });
}

function refuseRobots(): RobotsChecker {
  return async () => ({
    allowed: false,
    reason: "robots-disallowed",
    evidence: "/robots.txt disallows this path.",
  });
}

describe("the permission gate", () => {
  it("refuses a host sourcePolicy refuses, and sends nothing", async () => {
    const fetchImpl = vi.fn();
    const result = await scrapeMarkdown(REFUSED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      robots: allowRobots(),
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("SOURCE_REFUSED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an unrecorded host when no live robots check is supplied", async () => {
    const fetchImpl = vi.fn();
    const result = await scrapeMarkdown(UNRECORDED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("ROBOTS_UNCHECKED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an unrecorded host whose robots.txt says no, and spends no credit", async () => {
    const fetchImpl = vi.fn();
    const result = await scrapeMarkdown(UNRECORDED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      robots: refuseRobots(),
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("ROBOTS_REFUSED");
    expect(result.error.message).toContain("robots-disallowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads an unrecorded host once its own robots.txt allows it", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...scrapeOutput("markdown", "# Drinks"), url: UNRECORDED }),
    );
    const result = await scrapeMarkdown(UNRECORDED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      robots: allowRobots(),
      sleepImpl: noSleep,
    });
    expect(result).toEqual({ status: "ok", url: UNRECORDED, markdown: "# Drinks" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("names the refusal without a key present, before any key question", () => {
    expect(contextDevUrlRefusal(REFUSED)?.code).toBe("SOURCE_REFUSED");
    expect(contextDevUrlRefusal(UNRECORDED)?.code).toBe("ROBOTS_UNCHECKED");
    expect(contextDevUrlRefusal(UNRECORDED, { robots: allowRobots() })).toBeNull();
    expect(contextDevUrlRefusal(PERMITTED)).toBeNull();
  });

  it("answers not-configured before it answers refused", async () => {
    await expect(
      scrapeMarkdown(REFUSED, { env: {} as unknown as NodeJS.ProcessEnv }),
    ).resolves.toEqual({ status: "not-configured" });
  });
});

describe("maxAgeMs", () => {
  it("rides the request when the caller names it", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (input) => {
      seen.push(String(input));
      return jsonResponse(scrapeOutput("markdown", "x"));
    });
    await scrapeMarkdown(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxAgeMs: 0,
    });
    const request = new URL(seen[0]);
    expect(request.pathname).toBe("/v1/web/scrape/markdown");
    expect(request.searchParams.get("url")).toBe(PERMITTED);
    expect(request.searchParams.get("maxAgeMs")).toBe("0");
  });

  it("is absent from the request when the caller names none", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async (input) => {
      seen.push(String(input));
      return jsonResponse(scrapeOutput("markdown", "x"));
    });
    await scrapeMarkdown(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    const request = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(request.searchParams.get("maxAgeMs")).toBeNull();
  });
});

describe("scrapeHtml", () => {
  it("returns the page html", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(scrapeOutput("html", "<p>Pint</p>")),
    );
    const result = await scrapeHtml(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result).toEqual({ status: "ok", url: PERMITTED, html: "<p>Pint</p>" });
  });

  it("calls a 2xx carrying no html an empty body, and does not retry it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(scrapeOutput("html", null, false)));
    const result = await scrapeHtml(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not accept failed Markdown output from a partial scrape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      success: true,
      url: PERMITTED,
      markdown: "",
      contentLength: 0,
      finalDOMState: "still-loading",
      request_id: "test",
      cache_metadata: { age_ms: 0, status: "miss" },
      metadata: { finalUrl: PERMITTED, sourceUrl: PERMITTED },
    }));
    const result = await scrapeMarkdown(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not accept html from a partial scrape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      success: true,
      url: PERMITTED,
      html: "<partial>",
      type: "html" as const,
      finalDOMState: "still-loading",
      request_id: "test",
      cache_metadata: { age_ms: 0, status: "miss" },
      metadata: { finalUrl: PERMITTED, sourceUrl: PERMITTED },
    }));
    const result = await scrapeHtml(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("sitemapUrls", () => {
  it("returns the urls the domain's sitemap names", async () => {
    const fetchImpl = vi.fn<(input: unknown) => Promise<Response>>(async () =>
      jsonResponse({
        success: true,
        domain: "www.fullers.co.uk",
        urls: [{ url: "https://www.fullers.co.uk/a", title: "A" }, { url: "https://www.fullers.co.uk/b" }],
      }),
    );
    const result = await sitemapUrls(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.urls).toEqual(["https://www.fullers.co.uk/a", "https://www.fullers.co.uk/b"]);
    const request = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(request.pathname).toBe("/v1/web/urls");
    expect(request.searchParams.get("domain")).toBe("www.fullers.co.uk");
  });

  it("refuses a value that is not a url without sending anything", async () => {
    const fetchImpl = vi.fn();
    const result = await sitemapUrls("not a url", {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("SOURCE_REFUSED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("crawlMarkdown", () => {
  it("names each page by the url the crawl actually landed on", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            markdown: "# One",
            metadata: { finalUrl: "https://www.fullers.co.uk/one", sourceUrl: "https://www.fullers.co.uk/1" },
          },
          { markdown: "# Two", metadata: { sourceUrl: "https://www.fullers.co.uk/two" } },
        ],
      }),
    );
    const result = await crawlMarkdown(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxPages: 2,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.pages).toEqual([
      { url: "https://www.fullers.co.uk/one", markdown: "# One" },
      { url: "https://www.fullers.co.uk/two", markdown: "# Two" },
    ]);
  });
});

describe("searchWeb", () => {
  it("drops a hit whose host sourcePolicy refuses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        query: "cheapest pint",
        results: [
          { url: "https://www.fullers.co.uk/a", title: "A", description: "d", markdown: { markdown: "# A" } },
          { url: REFUSED, title: "B", description: "d", markdown: { markdown: "# B" } },
        ],
      }),
    );
    const result = await searchWeb("cheapest pint", {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      numResults: 10,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.results.map((hit) => hit.url)).toEqual(["https://www.fullers.co.uk/a"]);
    expect(result.results[0]?.markdown).toBe("# A");
  });
});

describe("brandRetrieve", () => {
  it("returns the brand record for the url's domain", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "ok", brand: { title: "Fuller's" } }));
    const result = await brandRetrieve(PERMITTED, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result).toEqual({
      status: "ok",
      domain: "www.fullers.co.uk",
      brand: { title: "Fuller's" },
    });
  });
});

describe("batchSubmit", () => {
  it("submits a permitted list and reports what was taken", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "batch_1", invalid_urls: [{ url: "https://www.fullers.co.uk/b" }] }),
    );
    const result = await batchSubmit(["https://www.fullers.co.uk/a", "https://www.fullers.co.uk/b"], {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result).toEqual({ status: "ok", batchId: "batch_1", submitted: 1, invalidUrls: 1 });
  });

  it("refuses the WHOLE submission when one url is refused", async () => {
    const fetchImpl = vi.fn();
    const result = await batchSubmit(["https://www.fullers.co.uk/a", REFUSED], {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("SOURCE_REFUSED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an empty list and one past the published ceiling", async () => {
    const fetchImpl = vi.fn();
    const empty = await batchSubmit([], { env: KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(empty.status).toBe("error");
    const overflow = await batchSubmit(
      Array.from({ length: CONTEXT_DEV_BATCH_MAX_URLS + 1 }, () => "https://www.fullers.co.uk/a"),
      { env: KEY, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(overflow.status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
