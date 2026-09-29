import { describe, expect, it, vi } from "vitest";

import { scrapeMarkdown } from "@/lib/contextDev";

const url = "https://www.fullers.co.uk/pubs/london/the-dove";

describe("Context.dev empty JSON responses", () => {
  it("classifies an empty HTTP 200 JSON body without Content-Length after one fetch", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
    );
    const sleepImpl = vi.fn(async () => {});

    const result = await scrapeMarkdown(url, {
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      sleepImpl,
    });

    expect(result).toMatchObject({ status: "error", error: { code: "EMPTY_BODY", retryable: false } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("keeps malformed nonempty JSON classified as a retryable network parse failure", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const sleepImpl = vi.fn(async () => {});

    const result = await scrapeMarkdown(url, {
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      sleepImpl,
    });

    expect(result).toMatchObject({ status: "error", error: { code: "NETWORK", retryable: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps genuine fetch failures retryable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const sleepImpl = vi.fn(async () => {});

    const result = await scrapeMarkdown(url, {
      env: { CONTEXT_DEV_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 2,
      sleepImpl,
    });

    expect(result).toMatchObject({ status: "error", error: { code: "NETWORK", retryable: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });
});
