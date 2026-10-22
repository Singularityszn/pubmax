import { afterEach, describe, expect, it, vi } from "vitest";

import { createUsageCapture } from "@/evals/pal/captureUsage";
import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import type { AskResponseBody } from "@/lib/ask/types";

describe.each([
  { topic: "hours", noun: "opening hours", copula: "are" },
  { topic: "price", noun: "prices", copula: "are" },
] as const)("Pal missing $topic statements", ({ topic, noun, copula }) => {
  const index = loadPalEvalVenueIndex();
  const venueId = "venue-60y3sa";
  const reference = topic === "hours"
    ? { hoursAnswer: { venueId, value: null } }
    : { priceAnswer: { venueId, value: null } };
  const body: AskResponseBody = {
    answer: "",
    cards: [{ key: "coronet", venueId, title: "The Coronet", place: "Islington", price: null, note: "" }],
    proposals: [], sources: [], status: "ready", toolsUsed: [],
  };

  it.each([
    `No ${noun} for The Coronet remain unknown.`,
    `No ${noun} recorded for The Coronet remain unknown.`,
    `No ${noun} for The Coronet have changed.`,
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].flatMap((absence) => [
      `The ${noun} of The Coronet have changed ${copula} ${absence}.`,
      `${absence} ${noun} for The Coronet remain unknown.`,
    ]),
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) =>
        `I ${inability} ${verb} the ${noun} of The Coronet have changed`)),
    `The ${noun} of Fox and Anchor ${copula} unknown.`,
    `No ${noun} for Imaginary Moon Tavern.`,
    `It is false that: The ${noun} ${copula} unknown.`,
  ])("rejects predicates and unrelated names in a refusal: %s", (answer) => {
    const outcome = gradePalCase({ ...body, answer }, reference, index);
    expect(outcome.checks).toContainEqual(expect.objectContaining({ name: `unknown_${topic}_disclosed`, pass: false }));
    expect(outcome.pass).toBe(false);
  });

  it.each([
    ...["unknown", "not known", "not recorded", "not available", "unavailable"].map((absence) =>
      `The ${noun} of The Coronet ${copula} ${absence}.`),
    `No ${noun}.`,
    ...["recorded", "listed", "known", "available"].flatMap((state) => [
      `No ${noun} for The Coronet ${copula} ${state}.`,
      `No ${noun} ${state} for The Coronet.`,
    ]),
    ...["cannot", "can't", "do not", "don't"].flatMap((inability) =>
      ["confirm", "verify", "provide", "know"].map((verb) =>
        `I ${inability} ${verb} the ${noun} of The Coronet.`)),
    `The Coronet: The ${noun} ${copula} unknown.`,
  ])("accepts a complete refusal for the expected venue: %s", (answer) => {
    expect(gradePalCase({ ...body, answer }, reference, index).pass).toBe(true);
  });

  it("does not trust a card title as a venue name", () => {
    const title = "The Coronet remain unknown";
    const outcome = gradePalCase({ ...body, answer: `No ${noun} for ${title}.`, cards: [{ ...body.cards[0]!, title }] }, reference, index);
    expect(outcome.pass).toBe(false);
  });

  it.each([
    ["venue-eltcmh", "The Black Friar"],
    ["venue-eltcmh", "The Black Friar, Blackfriars"],
    ["venue-phg4ss", "Fox and Anchor"],
  ])("accepts the canonical name or alias for %s: %s", (id, name) => {
    const expected = topic === "hours"
      ? { hoursAnswer: { venueId: id, value: null } }
      : { priceAnswer: { venueId: id, value: null } };
    const outcome = gradePalCase({ ...body, answer: `The ${noun} of ${name} ${copula} unknown.`,
      cards: [{ ...body.cards[0]!, venueId: id, title: name }],
    }, expected, index);
    expect(outcome.pass).toBe(true);
  });
});

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

  it("rejects an invented directory price when the real venue has no recorded price", () => {
    // The Coronet is in the committed London directory without a pint price.
    const unpricedVenueId = "venue-60y3sa";
    expect(index.ids.has(unpricedVenueId)).toBe(true);
    expect(index.priceById.has(unpricedVenueId)).toBe(false);

    const outcome = gradePalCase(body([{
      ...card(4.5, "directory"),
      venueId: unpricedVenueId,
      title: "The Coronet",
    }]), {}, index);

    expect(outcome.inventedVenues).toBe(0);
    expect(outcome.pass).toBe(false);
    expect(outcome.checks).toContainEqual({
      name: `price_data:${unpricedVenueId}`,
      pass: false,
      detail: "card=4.5 index=unknown",
    });
  });

  it("allows a directory card that leaves an unknown price empty", () => {
    const outcome = gradePalCase({
      ...body([]),
      cards: [{
        ...card(4.5, "directory"),
        venueId: "venue-60y3sa",
        title: "The Coronet",
        price: null,
      }],
    }, {}, index);

    expect(outcome.pass).toBe(true);
  });
});
