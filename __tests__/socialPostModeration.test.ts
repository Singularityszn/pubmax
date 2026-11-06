import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";

describe("OpenAI Social post moderation adapter", () => {
  it("reports whether the cron moderation key is present", () => {
    expect(isOpenAISocialModerationConfigured("")).toBe(false);
    expect(isOpenAISocialModerationConfigured("  ")).toBe(false);
    expect(isOpenAISocialModerationConfigured("test-key")).toBe(true);
  });

  it("uses the direct Moderations API and exact required model", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
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

  it.each([200, 500])("releases a stalled HTTP %i body with a retryable failure", async (status) => {
    let closed: (() => void) | undefined;
    const responseClosed = new Promise<"closed">((resolve) => {
      closed = () => resolve("closed");
    });
    const server = createServer((_request, response) => {
      response.once("close", () => closed?.());
      response.writeHead(status, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    let receivedHeaders = false;
    let failureWatchdog: ReturnType<typeof setTimeout> | undefined;
    let closureWatchdog: ReturnType<typeof setTimeout> | undefined;
    let requestCancellation: {
      signal: AbortSignal | null | undefined;
      bodyCancelInvoked: boolean;
      response: Response;
    } | undefined;

    try {
      const adapter = new OpenAISocialPostModerationAdapter({
        apiKey: "test-key",
        timeoutMs: 500,
        fetcher: async (_url, init) => {
          const response = await fetch(`http://127.0.0.1:${address.port}/moderation`, init);
          receivedHeaders = true;
          if (status === 500) {
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
          }
          return response;
        },
      });
      const failure = await Promise.race([
        adapter.moderate({ postId: "post-1", text: "Held" }).then(
          () => "unexpected_approval",
          (error: unknown) => error,
        ),
        new Promise<"deadline_missed">((resolve) => {
          failureWatchdog = setTimeout(() => resolve("deadline_missed"), 2_000);
        }),
      ]);

      expect(receivedHeaders).toBe(true);
      expect(failure).toMatchObject({
        message: status === 200
          ? "OpenAI moderation request failed."
          : "OpenAI moderation returned 500.",
        retryable: true,
      });
      const closure = await Promise.race([
        responseClosed,
        new Promise<"connection_retained">((resolve) => {
          closureWatchdog = setTimeout(() => resolve("connection_retained"), 2_000);
        }),
      ]);

      expect(closure).toBe("closed");
      if (status === 500) {
        expect(
          requestCancellation?.bodyCancelInvoked === true || requestCancellation?.signal?.aborted === true,
        ).toBe(true);
        expect(requestCancellation?.response.status).toBe(500);
      }
    } finally {
      clearTimeout(failureWatchdog);
      clearTimeout(closureWatchdog);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps a completed malformed JSON body non-retryable", async () => {
    const adapter = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response("{invalid", { status: 200 }),
    });

    await expect(adapter.moderate({ postId: "post-1", text: "Held" })).rejects.toMatchObject({
      message: "OpenAI moderation returned invalid JSON.",
      retryable: false,
    });
  });
});
