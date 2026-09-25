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

  function openRouterReply(usage: Record<string, number>, toolNames: string[] = []): Response {
    const message = {
      content: toolNames.length ? null : "hi",
      ...(toolNames.length
        ? {
            tool_calls: toolNames.map((name, i) => ({
              id: `call-${i}`,
              type: "function",
              function: { name, arguments: "{}" },
            })),
          }
        : {}),
    };
    return new Response(JSON.stringify({ choices: [{ message }], usage }), {
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
      modelToolCalls: 0,
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

  it("counts only allowlisted Ask tool calls the model asked for", async () => {
    vi.stubGlobal("fetch", async () =>
      openRouterReply({ cost: 0.001 }, ["city_status", "not_a_tool"]),
    );
    const capture = createUsageCapture();
    await capture.fetchImpl("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });

    expect(capture.take()).toMatchObject({ modelCalls: 1, modelToolCalls: 1 });
  });

  it("keeps every other service offline so live runs grade against the offline key", async () => {
    const globalFetch = vi.fn(async () => openRouterReply({ cost: 1 }));
    vi.stubGlobal("fetch", globalFetch);
    const capture = createUsageCapture();

    await expect(
      capture.fetchImpl("https://citymcp.com/london/mcp", { method: "POST" }),
    ).rejects.toThrow(/offline/i);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(capture.take().modelCalls).toBe(0);
  });
});

describe("Pal eval price grading", () => {
  const index = loadPalEvalVenueIndex();
  const [venueId, pint] = [...index.priceById.entries()][0]!;
  const card = (price: number, kind: "directory" | "whats-on") => ({
    key: `${kind}-${price}`,
    venueId,
    title: "Listed pub",
    place: "London",
    note: "",
    price,
    provenance: { label: kind, kind },
  });
  const body = (cards: ReturnType<typeof card>[]) => ({
    answer: "",
    cards,
    proposals: [],
    sources: [],
    status: "ready" as const,
    toolsUsed: ["search_venues"],
  });

  it("fails a directory card whose pint price disagrees with the record", () => {
    expect(gradePalCase(body([card(pint + 1, "directory")]), {}, index).pass).toBe(false);
    expect(gradePalCase(body([card(pint, "directory")]), {}, index).pass).toBe(true);
  });

  it("does not grade an event's entry fee as a pint price", () => {
    expect(gradePalCase(body([card(pint + 1, "whats-on")]), {}, index).pass).toBe(true);
  });
});
