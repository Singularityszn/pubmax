import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeAvatarModerationAdapter,
  createProfileAvatarModerationAdapter,
  OpenAIProfileAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";
import { CLAUDE_MESSAGES_URL, claudeJsonResponse, sentClaudeBody, sentClaudeUrl } from "@/__tests__/helpers/claudeWire";

const CLAUDE_ENV = { ANTHROPIC_API_KEY: "test-key" };

describe.each([
  ["OpenAI", OpenAIProfileAvatarModerationAdapter],
] as const)("%s moderation response deadline", (provider, Adapter) => {
  it("lets the upload scan recover when headers arrive but the HTTP body stalls", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    let receivedHeaders = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | null | undefined;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const scanner = new Adapter({
        apiKey: "test-key",
        timeoutMs: 500,
        fetcher: async (_url, init) => {
          requestSignal = init?.signal;
          const response = await fetch(`http://127.0.0.1:${address.port}/moderation`, init);
          receivedHeaders.resolve();
          return response;
        },
      });
      const outcome = scanUploadedImage({
        surface: "profile-avatar",
        signedUrl: "https://storage.test/signed-avatar",
        adapter: () => scanner,
      });
      await receivedHeaders.promise;
      await vi.advanceTimersByTimeAsync(500);

      expect(await outcome).toEqual({ verdict: "skipped", reason: "scan_failed" });
      expect(requestSignal?.aborted).toBe(true);
      receivedHeaders = Promise.withResolvers<void>();
      const failure = expect(scanner.moderate("https://storage.test/signed-avatar")).rejects.toMatchObject({
        message: `${provider} moderation request failed.`,
        retryable: true,
      });
      await receivedHeaders.promise;
      await vi.advanceTimersByTimeAsync(500);
      await failure;
    } finally {
      vi.useRealTimers();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("closes a stalled HTTP error body and preserves its retryable status failure", async () => {
    let closed: (() => void) | undefined;
    const responseClosed = new Promise<"closed">((resolve) => {
      closed = () => resolve("closed");
    });
    const server = createServer((_request, response) => {
      response.once("close", () => closed?.());
      response.writeHead(500, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let requestCancellation: {
      signal: AbortSignal | null | undefined;
      bodyCancelInvoked: boolean;
      response: Response;
    } | undefined;

    try {
      const scanner = new Adapter({
        apiKey: "test-key",
        timeoutMs: 500,
        fetcher: async (_url, init) => {
          const response = await fetch(`http://127.0.0.1:${address.port}/moderation`, init);
          const cancellation = { signal: init?.signal, bodyCancelInvoked: false, response };
          requestCancellation = cancellation;
          const body = response.body;
          if (body) {
            const originalCancel = body.cancel;
            body.cancel = function (this: ReadableStream<Uint8Array>, ...args: Parameters<typeof originalCancel>) {
              cancellation.bodyCancelInvoked = true;
              return Reflect.apply(originalCancel, this, args);
            };
          }
          return response;
        },
      });
      await expect(scanner.moderate("https://storage.test/signed-avatar")).rejects.toMatchObject({
        message: `${provider} moderation returned 500.`,
        retryable: true,
      });
      const outcome = await Promise.race([
        responseClosed,
        new Promise<"connection_retained">((resolve) => {
          watchdog = setTimeout(() => resolve("connection_retained"), 2_000);
        }),
      ]);

      expect(outcome).toBe("closed");
      // The unread error body is cancelled explicitly, not left to the deadline.
      expect(requestCancellation?.bodyCancelInvoked).toBe(true);
      expect(requestCancellation?.response.status).toBe(500);
    } finally {
      clearTimeout(watchdog);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps a completed malformed JSON body non-retryable", async () => {
    const scanner = new Adapter({
      apiKey: "test-key",
      fetcher: async () => new Response("{invalid", { status: 200 }),
    });

    await expect(scanner.moderate("https://storage.test/signed-avatar")).rejects.toMatchObject({
      message: `${provider} moderation returned invalid JSON.`,
      retryable: false,
    });
  });
});

describe("OpenAI profile avatar moderation adapter", () => {
  it("uses the direct Moderations API with image-only omni input", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAIProfileAvatarModerationAdapter({ apiKey: "test-key", fetcher });

    await expect(adapter.moderate("https://storage.test/signed-avatar"))
      .resolves.toEqual({ decision: "approved" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(sentInit?.body));
    expect(body).toEqual({
      model: "omni-moderation-latest",
      input: [
        { type: "image_url", image_url: { url: "https://storage.test/signed-avatar" } },
      ],
    });
  });

  it("never sends a handle, profile id, or account identifier in the request body", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAIProfileAvatarModerationAdapter({ apiKey: "test-key", fetcher });

    await adapter.moderate("https://storage.test/avatars/signed");

    const raw = String(sentInit?.body);
    expect(raw).not.toContain("profile-");
    expect(raw).not.toContain("@alice");
    expect(raw).not.toContain("user-1");
    expect(raw).not.toContain("mem-profile");
    expect(JSON.parse(raw).input).toHaveLength(1);
    expect(JSON.parse(raw).input[0].type).toBe("image_url");
  });

  it("returns needs-review for flagged content and throws on outage or malformed results", async () => {
    const flagged = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 }),
    });
    await expect(flagged.moderate("https://storage.test/bad"))
      .resolves.toEqual({ decision: "needs_review" });

    const outage = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate("https://storage.test/held")).rejects.toThrow();

    const malformed = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    await expect(malformed.moderate("https://storage.test/held")).rejects.toThrow();
  });

  it("fails closed when OPENAI_API_KEY is missing", () => {
    expect(() => new OpenAIProfileAvatarModerationAdapter({ apiKey: "" }))
      .toThrow(/not configured/i);
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenAIProfileAvatarModerationAdapter({
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
      adapter.moderate("https://storage.test/held")
        .then(() => "approved", (error: unknown) =>
          error && typeof error === "object" && "retryable" in error ? "retryable" : "failed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("not_aborted"), 100)),
    ]);

    expect(outcome).toBe("retryable");
    expect(observedSignals.at(0)?.aborted).toBe(true);
  });
});

describe("Claude profile avatar moderation adapter", () => {
  it("sends the signed URL as the only image, with a strict one-field schema", async () => {
    const fetcher = vi.fn(async () => claudeJsonResponse({ flagged: false }));
    const adapter = new ClaudeAvatarModerationAdapter({ env: CLAUDE_ENV, fetcher });

    await expect(adapter.moderate("https://storage.test/signed-avatar"))
      .resolves.toEqual({ decision: "approved" });

    expect(sentClaudeUrl(fetcher.mock.calls[0])).toBe(CLAUDE_MESSAGES_URL);
    const body = sentClaudeBody(fetcher.mock.calls[0]);
    expect(body.messages).toEqual([{
      role: "user",
      content: [{ type: "image", source: { type: "url", url: "https://storage.test/signed-avatar" } }],
    }]);
    expect(body.output_config.format.schema).toMatchObject({
      type: "object", required: ["flagged"], properties: { flagged: { type: "boolean" } },
    });
  });

  it("never sends a handle, profile id, or account identifier in the request body", async () => {
    const fetcher = vi.fn(async () => claudeJsonResponse({ flagged: false }));
    const adapter = new ClaudeAvatarModerationAdapter({ env: CLAUDE_ENV, fetcher });

    await adapter.moderate("https://storage.test/avatars/signed");

    const raw = JSON.stringify(sentClaudeBody(fetcher.mock.calls[0]));
    expect(raw).not.toContain("profile-");
    expect(raw).not.toContain("@alice");
    expect(raw).not.toContain("user-1");
    expect(raw).not.toContain("mem-profile");
  });

  it("returns needs-review for flagged content", async () => {
    const adapter = new ClaudeAvatarModerationAdapter({
      env: CLAUDE_ENV,
      fetcher: async () => claudeJsonResponse({ flagged: true }),
    });
    await expect(adapter.moderate("https://storage.test/bad"))
      .resolves.toEqual({ decision: "needs_review" });
  });

  it.each([
    ["a refusal", () => claudeJsonResponse({ flagged: false }, "refusal"), false],
    ["text that is not JSON", () => claudeJsonResponse("I cannot classify that image."), false],
    ["an outage", () => new Response("offline", { status: 503 }), true],
  ])("throws on %s, retryable only for an outage", async (_name, response, retryable) => {
    const adapter = new ClaudeAvatarModerationAdapter({ env: CLAUDE_ENV, fetcher: async () => response() });
    await expect(adapter.moderate("https://storage.test/held")).rejects.toMatchObject({
      message: "Claude moderation request failed.",
      retryable,
    });
  });

  it("throws when the answer has no boolean decision", async () => {
    const adapter = new ClaudeAvatarModerationAdapter({
      env: CLAUDE_ENV,
      fetcher: async () => claudeJsonResponse({ decision: "ok" }),
    });
    await expect(adapter.moderate("https://storage.test/held")).rejects.toThrow(/no decision/i);
  });

  it("fails closed when ANTHROPIC_API_KEY is missing", () => {
    expect(() => new ClaudeAvatarModerationAdapter({ env: { ANTHROPIC_API_KEY: " " } }))
      .toThrow(/not configured/i);
  });

  it("lets the upload scan recover when headers arrive but the HTTP body stalls", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const signals: Array<AbortSignal | null | undefined> = [];
    try {
      const scanner = new ClaudeAvatarModerationAdapter({
        env: CLAUDE_ENV,
        timeoutMs: 100,
        fetcher: async (_url, init) => {
          signals.push(init?.signal);
          return fetch(`http://127.0.0.1:${address.port}/v1/messages`, init);
        },
      });

      expect(await scanUploadedImage({
        surface: "profile-avatar",
        signedUrl: "https://storage.test/signed-avatar",
        adapter: () => scanner,
      })).toEqual({ verdict: "skipped", reason: "scan_failed" });
      expect(signals[0]?.aborted).toBe(true);
      await expect(scanner.moderate("https://storage.test/signed-avatar")).rejects.toMatchObject({
        message: "Claude moderation request failed.",
        retryable: true,
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("profile avatar moderation provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers OpenAI when both keys are present", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(OpenAIProfileAvatarModerationAdapter);
  });

  it("uses Claude when only ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(ClaudeAvatarModerationAdapter);
  });

  it("throws when neither moderation key is configured, even with a leftover OpenRouter key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(() => createProfileAvatarModerationAdapter()).toThrow(/not configured/i);
  });
});
