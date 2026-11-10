import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProfileAvatarModerationAdapter,
  extractModerationJsonObject,
  OpenAIProfileAvatarModerationAdapter,
  OpenRouterAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";
import { scanUploadedImage } from "@/lib/uploadedImageScan.server";

function openRouterResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe.each([
  ["OpenAI", OpenAIProfileAvatarModerationAdapter],
  ["OpenRouter", OpenRouterAvatarModerationAdapter],
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

describe("OpenRouter profile avatar moderation adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("posts a vision chat completion with image-only user content", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      model: "openai/gpt-5.2",
      fetcher,
    });

    await expect(adapter.moderate("https://storage.test/signed-avatar"))
      .resolves.toEqual({ decision: "approved" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(sentInit?.body));
    expect(body.model).toBe("openai/gpt-5.2");
    expect(body.messages).toHaveLength(1);
    const parts = body.messages[0].content;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe("text");
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://storage.test/signed-avatar" },
    });
  });

  it("never sends a handle, profile id, or account identifier in the request body", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({ apiKey: "or-key", fetcher });

    await adapter.moderate("https://storage.test/avatars/signed");

    const raw = String(sentInit?.body);
    expect(raw).not.toContain("profile-");
    expect(raw).not.toContain("@alice");
    expect(raw).not.toContain("user-1");
    expect(raw).not.toContain("mem-profile");
    const body = JSON.parse(raw);
    const imageParts = body.messages[0].content.filter(
      (part: { type?: string }) => part.type === "image_url",
    );
    expect(imageParts).toHaveLength(1);
  });

  it("returns needs-review for flagged content", async () => {
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('{"flagged": true}'),
    });
    await expect(adapter.moderate("https://storage.test/bad"))
      .resolves.toEqual({ decision: "needs_review" });
  });

  it("parses JSON from fenced model replies", async () => {
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('```json\n{"flagged": false}\n```'),
    });
    await expect(adapter.moderate("https://storage.test/clean"))
      .resolves.toEqual({ decision: "approved" });
  });

  it("throws on refusal text, malformed JSON, outage, and missing boolean", async () => {
    const refusal = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse("I cannot classify that image."),
    });
    await expect(refusal.moderate("https://storage.test/held")).rejects.toThrow(/no decision/i);

    const malformed = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('{"decision":"ok"}'),
    });
    await expect(malformed.moderate("https://storage.test/held")).rejects.toThrow(/no decision/i);

    const outage = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate("https://storage.test/held")).rejects.toThrow();
  });

  it("fails closed when OPENROUTER_API_KEY is missing", () => {
    expect(() => new OpenRouterAvatarModerationAdapter({ apiKey: "" }))
      .toThrow(/not configured/i);
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
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

  it("reads OPENROUTER_MODERATION_MODEL from the environment", async () => {
    vi.stubEnv("OPENROUTER_MODERATION_MODEL", "google/gemini-2.5-flash");
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({ apiKey: "or-key", fetcher });
    await adapter.moderate("https://storage.test/signed");
    expect(JSON.parse(String(sentInit?.body)).model).toBe("google/gemini-2.5-flash");
  });
});

describe("extractModerationJsonObject", () => {
  it("accepts bare JSON and fenced blocks", () => {
    expect(extractModerationJsonObject('{"flagged":true}')).toEqual({ flagged: true });
    expect(extractModerationJsonObject('Here:\n```json\n{"flagged": false}\n```'))
      .toEqual({ flagged: false });
  });
});

describe("profile avatar moderation provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers OpenAI when both keys are present", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(OpenAIProfileAvatarModerationAdapter);
  });

  it("uses OpenRouter when only OPENROUTER_API_KEY is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(OpenRouterAvatarModerationAdapter);
  });

  it("throws when neither moderation key is configured", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() => createProfileAvatarModerationAdapter()).toThrow(/not configured/i);
  });
});
