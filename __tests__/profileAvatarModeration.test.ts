import { describe, expect, it, vi } from "vitest";

import { OpenAIProfileAvatarModerationAdapter } from "@/lib/profileAvatarModeration";

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
