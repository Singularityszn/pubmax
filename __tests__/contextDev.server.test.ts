import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_DEV_MAX_ATTEMPTS,
  contextDevApiKey,
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

describe("contextDev key configuration", () => {
  it("reads the key from the environment and trims it", () => {
    expect(contextDevApiKey({ CONTEXT_DEV_API_KEY: "  ctx-key  " } as NodeJS.ProcessEnv)).toBe("ctx-key");
    expect(isContextDevConfigured({ CONTEXT_DEV_API_KEY: "ctx-key" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("treats an absent or blank key as not configured", () => {
    expect(contextDevApiKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(isContextDevConfigured({ CONTEXT_DEV_API_KEY: "  " } as NodeJS.ProcessEnv)).toBe(false);
    expect(scrapeMarkdown("https://example.com", { env: {} as NodeJS.ProcessEnv })).resolves.toEqual({
      status: "not-configured",
    });
  });
});

describe("scrapeMarkdown", () => {
  it("returns markdown on success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, url: "https://example.com/page", markdown: "# Hello" }),
    );
    const result = await scrapeMarkdown("https://example.com/page", {
      env: { CONTEXT_DEV_API_KEY: "key" } as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result).toEqual({
      status: "ok",
      url: "https://example.com/page",
      markdown: "# Hello",
    });
  });

  it("honours Retry-After on 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, url: "https://example.com", markdown: "ok" }));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://example.com", {
      env: { CONTEXT_DEV_API_KEY: "key" } as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      maxAttempts: 2,
    });
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps[0]).toBe(2000);
  });

  it("retries 5xx with bounded backoff then fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const sleeps: number[] = [];
    const result = await scrapeMarkdown("https://example.com", {
      env: { CONTEXT_DEV_API_KEY: "key" } as NodeJS.ProcessEnv,
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
    const result = await scrapeMarkdown("https://example.com", {
      env: { CONTEXT_DEV_API_KEY: "key" } as NodeJS.ProcessEnv,
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

describe("extract", () => {
  it("returns structured data on success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        url: "https://example.com/events",
        data: {
          events: [
            {
              title: "Quiz night",
              placeName: "The Red Lion",
              kind: "event",
              sourceUrl: "https://example.com/e/1",
            },
          ],
        },
        urls_analyzed: ["https://example.com/events"],
      }),
    );
    const result = await extract("https://example.com/events", { type: "object" }, {
      env: { CONTEXT_DEV_API_KEY: "key" } as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.data.events).toHaveLength(1);
  });
});
