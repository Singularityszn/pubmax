import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";

import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";

describe("OpenAI Social post moderation adapter", () => {
  it("times out a real HTTP response that flushes headers but never finishes its JSON body", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      response.write('{"results":[');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local server address.");
    let headersReceived = false;
    let signal: AbortSignal | null | undefined;
    const adapter = new OpenAISocialPostModerationAdapter({
      apiKey: "local-test-key",
      timeoutMs: 250,
      fetcher: async (_url, init) => {
        signal = init?.signal;
        const response = await fetch(`http://127.0.0.1:${address.port}`, init);
        headersReceived = true;
        return response;
      },
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const outcome = adapter.moderate({ postId: "post-1", text: "Evening" })
      .then(value => value, (error: unknown) => error);
    try {
      const result = await Promise.race([
        outcome,
        new Promise(resolve => { watchdog = setTimeout(() => resolve("body still pending"), 2_000); }),
      ]);
      expect(headersReceived).toBe(true);
      expect(result).toMatchObject({ message: "OpenAI moderation request timed out.", retryable: true });
      expect(signal?.aborted).toBe(true);
    } finally {
      clearTimeout(watchdog);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await outcome;
    }
  });

  it.each([
    ["invalid JSON", "{", { message: "OpenAI moderation returned invalid JSON.", retryable: false }],
    ["invalid schema", '{"results":[]}', { message: "OpenAI moderation returned no decision.", retryable: false }],
    ["valid decision", '{"results":[{"flagged":false}]}', null],
  ])("cleans up the deadline after %s", async (_label, body, expectedError) => {
    vi.useFakeTimers();
    try {
      const adapter = new OpenAISocialPostModerationAdapter({
        apiKey: "test-key",
        fetcher: async () => new Response(body),
      });
      const result = adapter.moderate({ postId: "post-1", text: "Evening" });
      if (expectedError) await expect(result).rejects.toMatchObject(expectedError);
      else await expect(result).resolves.toEqual({ decision: "approved" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports whether the cron moderation key is present", () => {
    expect(isOpenAISocialModerationConfigured("")).toBe(false);
    expect(isOpenAISocialModerationConfigured("  ")).toBe(false);
    expect(isOpenAISocialModerationConfigured("test-key")).toBe(true);
  });

  it("uses the direct Moderations API and exact required model", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAISocialPostModerationAdapter({ apiKey: "test-key", fetcher });

    await expect(adapter.moderate({ postId: "post-1", text: "Evening" }))
      .resolves.toEqual({ decision: "approved" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "omni-moderation-latest", input: "Evening" }),
      }),
    );
  });

  it("sends canonical text and the normalised private image in one multimodal decision", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAISocialPostModerationAdapter({ apiKey: "test-key", fetcher });

    await adapter.moderate({
      postId: "post-1",
      text: "Evening\n\n#camden\n\nPhoto: Friends outside a pub",
      imageUrl: "https://storage.test/signed-image",
    });

    const body = JSON.parse(String(sentInit?.body));
    expect(body).toEqual({
      model: "omni-moderation-latest",
      input: [
        { type: "text", text: "Evening\n\n#camden\n\nPhoto: Friends outside a pub" },
        { type: "image_url", image_url: { url: "https://storage.test/signed-image" } },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("profile-");
    expect(JSON.stringify(body)).not.toContain("@alice");
  });

  it("returns needs-review for flagged content and throws on outage or malformed results", async () => {
    const flagged = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 }),
    });
    await expect(flagged.moderate({ postId: "post-1", text: "Bad" }))
      .resolves.toEqual({ decision: "needs_review" });

    const outage = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate({ postId: "post-1", text: "Held" })).rejects.toThrow();

    const malformed = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    await expect(malformed.moderate({ postId: "post-1", text: "Held" })).rejects.toThrow();
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      timeoutMs: 5,
      fetcher: (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        observedSignals.push(signal);
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      }),
    });

    const outcome = await Promise.race([
      adapter.moderate({ postId: "post-1", text: "Held" })
        .then(() => "approved", (error: unknown) =>
          error && typeof error === "object" && "retryable" in error ? "retryable" : "failed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("not_aborted"), 100)),
    ]);

    expect(outcome).toBe("retryable");
    expect(observedSignals.at(0)?.aborted).toBe(true);
  });
});
