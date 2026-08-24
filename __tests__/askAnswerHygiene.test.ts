// Pub Pal answer hygiene (review report D5). The reader of a Pal answer never
// sees plumbing: no internal service names, no "rows", no ask-classifier
// wording. Every sentence a tool hands back is one a person would say at the
// bar, and the cards an answer counts are the cards it prints.

import { describe, expect, it } from "vitest";

import { mergeToolResults } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import type { AskToolContext, AskToolResult } from "@/lib/ask/toolContract";
import type { AskCard } from "@/lib/ask/types";

const PLUMBING_TOKENS = [
  "CityMCP",
  "rows",
  "What's On ask",
  "grounded",
] as const;

function readerText(result: AskToolResult): string {
  return [
    result.answerHint ?? "",
    ...result.cards.flatMap((card) => [card.title, card.place, card.note]),
  ].join(" ");
}

function ctx(overrides: Partial<AskToolContext> = {}): AskToolContext {
  return {
    cityId: "london",
    query: "",
    skipModel: true,
    ...overrides,
  };
}

const failingFetch: typeof fetch = async () => {
  throw new Error("upstream down");
};

describe("Pal answer hygiene", () => {
  it("keeps plumbing out of a degraded area buzz answer", async () => {
    const result = await runAskTool(
      "area_buzz",
      { area: "Shoreditch" },
      ctx({ query: "what's it like in Shoreditch", fetchImpl: failingFetch }),
    );
    const text = readerText(result);
    for (const token of PLUMBING_TOKENS) {
      expect(text).not.toContain(token);
    }
    expect(text).toContain("Couldn't check the average pint for Shoreditch");
  });

  it("answers a non-listings ask with what to ask for, not a classifier verdict", async () => {
    const result = await runAskTool(
      "whats_on",
      { query: "how do magnets work" },
      ctx({ query: "how do magnets work" }),
    );
    expect(result.answerHint).toBe(
      "Ask about quiz nights, live music, sport or deals and I'll check the listings.",
    );
    expect(result.answerHint).not.toContain("What's On ask");
  });

  it("counts one card for one pub, whichever tools answered it", () => {
    const card = (key: string, venueId: string): AskCard => ({
      key,
      venueId,
      title: "The Lamb",
      place: "Bloomsbury",
      note: "",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    });
    const result = (cards: AskCard[]): AskToolResult => ({
      ok: true,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards,
      proposals: [],
      answerHint: "",
    });
    const merged = mergeToolResults([
      result([card("cheapest:venue-1", "venue-1")]),
      result([card("venue-1", "venue-1"), card("venue-2", "venue-2")]),
    ]);
    expect(merged.cards).toHaveLength(2);
    expect(merged.cards.map((c) => c.venueId)).toEqual(["venue-1", "venue-2"]);
  });
});
