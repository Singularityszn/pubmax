import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_DEV_MAX_ATTEMPTS,
  CONTEXT_DEV_MAX_RETRY_AFTER_MS,
  contextDevApiKey,
  createContextDevBudget,
  extract,
  isContextDevConfigured,
  scrapeMarkdown,
} from "@/lib/contextDev.server";

const noSleep = async () => {};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function markdownResponse(markdown: string) {
  return jsonResponse({
    url: "https://www.fullers.co.uk/event-finder",
    markdown: { requested: true, success: true, data: markdown },
  });
}

describe("contextDev key configuration", () => {
  it("reads the key from the environment and trims it", () => {
    expect(contextDevApiKey({ CONTEXT_DEV_API_KEY: "  ctx-key  " } as unknown as NodeJS.ProcessEnv)).toBe("ctx-key");
    expect(isContextDevConfigured({ CONTEXT_DEV_API_KEY: "ctx-key" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("treats an absent or blank key as not configured", async () => {
    expect(contextDevApiKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(isContextDevConfigured({ CONTEXT_DEV_API_KEY: "  " } as unknown as NodeJS.ProcessEnv)).toBe(false);
    await expect(
      scrapeMarkdown("https://www.fullers.co.uk", { env: {} as unknown as NodeJS.ProcessEnv }),
    ).resolves.toEqual({ status: "not-configured" });
  });
});

describe("scrapeMarkdown", () => {
  it("returns markdown on success", async () => {
    const fetchImpl = vi.fn(async () =>
      markdownResponse("# Hello"),
    );
    const result = await scrapeMarkdown("https://www.fullers.co.uk/event-finder", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result).toEqual({
      status: "ok",
      url: "https://www.fullers.co.uk/event-finder",
      markdown: "# Hello",
    });
  });

  it("honours Retry-After on 429", async () => {
    // The wait is 7s, deliberately unequal to CONTEXT_DEV_RETRY_BASE_DELAY_MS *
    // attempt (2000ms), so the assertion proves the header was READ rather than
    // matching the ordinary backoff by coincidence.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "slow down" }, 429, { "retry-after": "7" }),
      )
      .mockResolvedValueOnce(markdownResponse("ok"));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: 2,
    });
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps[0]).toBe(7000);
  });

  it("honours Retry-After on a 429 whose body is not JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>slow down</html>", {
          status: 429,
          headers: { "content-type": "text/html", "retry-after": "7" },
        }),
      )
      .mockResolvedValueOnce(markdownResponse("ok"));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: 2,
    });
    expect(result.status).toBe("ok");
    expect(sleeps[0]).toBe(7000);
  });

  it("does not retry a validation answer whose body is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>Forbidden</html>", {
          status: 403,
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.retryable).toBe(false);
    expect(result.error.statusCode).toBe(403);
    expect(result.error.code).toBe("INVALID_REQUEST");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops instead of waiting when Retry-After asks past the ceiling", async () => {
    const askedSeconds = Math.round(CONTEXT_DEV_MAX_RETRY_AFTER_MS / 1000) + 60;
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "slow down" }, 429, { "retry-after": String(askedSeconds) }),
    );
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: CONTEXT_DEV_MAX_ATTEMPTS,
    });

    expect(sleeps).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.statusCode).toBe(429);
    expect(result.error.retryable).toBe(false);
    expect(result.error.message).toContain(`${askedSeconds}s`);
    expect(result.error.message).toContain("ceiling");
  });

  it("still waits a Retry-After inside the ceiling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "slow down" }, 429, {
          "retry-after": String(Math.round(CONTEXT_DEV_MAX_RETRY_AFTER_MS / 1000)),
        }),
      )
      .mockResolvedValueOnce(markdownResponse("ok"));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: 2,
    });

    expect(sleeps).toEqual([CONTEXT_DEV_MAX_RETRY_AFTER_MS]);
    expect(result.status).toBe("ok");
  });

  it("retries 5xx with bounded backoff then fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: CONTEXT_DEV_MAX_ATTEMPTS,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(CONTEXT_DEV_MAX_ATTEMPTS);
    expect(sleeps.length).toBe(CONTEXT_DEV_MAX_ATTEMPTS - 1);
  });

  it("does not retry validation errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad schema" }, 400));
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("run request budget", () => {
  it("counts retries against the budget and stops sending once it is spent", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const budget = createContextDevBudget(2);
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxAttempts: CONTEXT_DEV_MAX_ATTEMPTS,
      budget,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remaining()).toBe(0);
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    // The ceiling stopped the retry, but the 503 is what an operator can act
    // on, so it stays the answer and the budget rides in the message.
    expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(result.error.statusCode).toBe(503);
    expect(result.error.message).toContain("No further attempt was made");
  });

  it("names the budget alone when the ceiling stopped the FIRST attempt", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const budget = createContextDevBudget(1);
    await scrapeMarkdown("https://www.fullers.co.uk/first", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      maxAttempts: 1,
      budget,
    });
    fetchImpl.mockClear();

    const result = await scrapeMarkdown("https://www.fullers.co.uk/second", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      budget,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("BUDGET_EXHAUSTED");
    expect(result.error.retryable).toBe(false);
    expect(result.error.statusCode).toBeUndefined();
  });

  it("sends nothing at all once a shared budget is spent", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const budget = createContextDevBudget(1);
    await scrapeMarkdown("https://www.fullers.co.uk/one", {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      budget,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await extract("https://www.fullers.co.uk/two", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      budget,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.status).toBe("error");
    if (second.status !== "error") throw new Error("expected error");
    expect(second.error.code).toBe("BUDGET_EXHAUSTED");
  });

  it("spends nothing when the key is absent, because nothing is sent", async () => {
    const budget = createContextDevBudget(2);
    const result = await scrapeMarkdown("https://www.fullers.co.uk", {
      env: {} as unknown as NodeJS.ProcessEnv,
      budget,
    });
    expect(result).toEqual({ status: "not-configured" });
    expect(budget.remaining()).toBe(2);
  });
});

describe("extract", () => {
  it("returns structured data on success", async () => {
    const fetchImpl = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        url: "https://www.fullers.co.uk/events",
        json: { requested: true, success: true, data: {
          events: [
            {
              title: "Quiz night",
              placeName: "The Red Lion",
              kind: "event",
              sourceUrl: "https://example.com/e/1",
            },
          ],
        } },
        markdown: { requested: true, success: true, data: "# Events\nQuiz night at The Red Lion" },
      }),
    );
    const result = await extract("https://www.fullers.co.uk/events", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      instructions: "Use only page evidence.",
      maxAgeMs: 0,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.data.events).toHaveLength(1);
    expect(result.markdown).toContain("Quiz night");
    expect(result.urlsAnalyzed).toEqual(["https://www.fullers.co.uk/events"]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/v1/web/scrape");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      url: "https://www.fullers.co.uk/events",
      formats: { json: true, markdown: true },
      jsonParams: { schema: { type: "object" }, instructions: "Use only page evidence." },
      maxAgeMs: 0,
    });
  });

  it("fails closed when JSON extraction failed despite a successful page scrape", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      url: "https://www.fullers.co.uk/events",
      markdown: { requested: true, success: true, data: "# Events" },
      json: { requested: true, success: false, data: null },
      isPartial: true,
    }));
    const result = await extract("https://www.fullers.co.uk/events", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when JSON succeeds but same-scrape Markdown evidence is absent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      url: "https://www.fullers.co.uk/events",
      json: { requested: true, success: true, data: { events: [{ title: "Quiz" }] } },
      markdown: { requested: true, success: false, data: null },
      isPartial: true,
    }));
    const result = await extract("https://www.fullers.co.uk/events", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
  });

  it("refuses extraction without the SDK's final URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      json: { requested: true, success: true, data: { events: [] } },
      markdown: { requested: true, success: true, data: "# Events" },
    }));
    const result = await extract("https://www.fullers.co.uk/events", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("EMPTY_BODY");
  });
});
