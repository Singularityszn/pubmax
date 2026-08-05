import { describe, expect, it, vi } from "vitest";

import { OpenAISocialPostModerationAdapter } from "@/lib/socialPostModeration";

describe("OpenAI Social post moderation adapter", () => {
  it("uses the direct Moderations API and exact required model", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{ flagged: false }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
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
});
