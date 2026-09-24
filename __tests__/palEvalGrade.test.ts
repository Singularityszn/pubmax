import { afterEach, describe, expect, it, vi } from "vitest";

import { createUsageCapture } from "@/evals/pal/captureUsage";
import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";

describe("Pal eval graders", () => {
  it("flags invented venue ids on cards", () => {
    const index = loadPalEvalVenueIndex();
    const outcome = gradePalCase(
      {
        answer: "1 pick.",
        cards: [
          {
            key: "fake",
            venueId: "venue-not-in-index",
            title: "Imaginary Arms",
            place: "Soho",
            note: "",
            price: 4.5,
          },
        ],
        proposals: [],
        sources: [],
        status: "ready",
        toolsUsed: ["search_venues"],
      },
      { expectedTools: ["search_venues"], minCards: 1 },
      index,
    );
    expect(outcome.inventedVenues).toBe(1);
    expect(outcome.pass).toBe(false);
  });
});

describe("Pal eval usage capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function openRouterReply(usage: Record<string, number>): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("prices a conversation from the cost OpenRouter reports", async () => {
    vi.stubGlobal("fetch", async () =>
      openRouterReply({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0042 }),
    );
    const capture = createUsageCapture();
    await capture.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });
    await capture.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });

    expect(capture.take()).toEqual({
      modelCalls: 2,
      promptTokens: 200,
      completionTokens: 40,
      totalTokens: 240,
      costUsd: 0.0084,
    });
    expect(capture.take().modelCalls).toBe(0);
  });

  it("refuses to report a conversation OpenRouter did not price", async () => {
    vi.stubGlobal("fetch", async () =>
      openRouterReply({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }),
    );
    const capture = createUsageCapture();
    await capture.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });

    expect(() => capture.take()).toThrow(/usage\.cost/);
  });

  it("does not count calls to other services as model calls", async () => {
    vi.stubGlobal("fetch", async () => openRouterReply({ cost: 1 }));
    const capture = createUsageCapture();
    await capture.fetchImpl("https://citymcp.com/london/mcp", { method: "POST" });

    expect(capture.take().modelCalls).toBe(0);
  });
});
