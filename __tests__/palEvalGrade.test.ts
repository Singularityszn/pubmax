import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { createUsageCapture } from "@/evals/pal/captureUsage";
import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import type { ClaudeClient } from "@/lib/claudeClient.server";
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
  function claudeRound(usage: Partial<Anthropic.Usage>, toolNames: string[] = []): Anthropic.Message {
    return {
      id: "msg-test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: toolNames.length
        ? toolNames.map((name, i) => ({ type: "tool_use", id: `call-${i}`, name, input: {} }))
        : [{ type: "text", text: "hi" }],
      stop_reason: toolNames.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, ...usage },
    } as unknown as Anthropic.Message;
  }

  /** A Claude client that answers every round with `message`. */
  function claudeAnswering(message: Anthropic.Message): ClaudeClient {
    return { stream: () => ({ on: () => undefined, finalMessage: async () => message }) };
  }

  async function round(capture: ReturnType<typeof createUsageCapture>): Promise<void> {
    await capture.claude
      .stream({ model: "claude-haiku-5-5", max_tokens: 1, messages: [] }, { signal: new AbortController().signal })
      .finalMessage();
  }

  it("prices a conversation from the token counts Claude reports", async () => {
    const capture = createUsageCapture(
      claudeAnswering(claudeRound({ input_tokens: 100, cache_read_input_tokens: 1_000, output_tokens: 20 })),
      "claude-haiku-5-5",
    );
    await round(capture);
    await round(capture);

    const taken = capture.take();
    expect(taken).toMatchObject({
      modelCalls: 2,
      modelToolCalls: 0,
      promptTokens: 2_200,
      completionTokens: 40,
      totalTokens: 2_240,
    });
    // Per round: (100 + 1,000 x 0.1) input at $0.10/M and 20 output at $0.50/M.
    expect(taken.costUsd).toBeCloseTo(2 * (200 * 0.1 + 20 * 0.5) / 1_000_000, 12);
    expect(capture.take().modelCalls).toBe(0);
  });

  it("refuses to report a conversation on a model it has no rate for", async () => {
    const capture = createUsageCapture(claudeAnswering(claudeRound({ input_tokens: 100 })), "claude-unpriced");
    await round(capture);

    expect(() => capture.take()).toThrow(/cannot price/);
  });

  it("counts only allowlisted Ask tool calls the model asked for", async () => {
    const capture = createUsageCapture(
      claudeAnswering(claudeRound({ input_tokens: 1 }, ["city_status", "not_a_tool"])),
      "claude-haiku-5-5",
    );
    await round(capture);

    expect(capture.take()).toMatchObject({ modelCalls: 1, modelToolCalls: 1 });
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
