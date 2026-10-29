import { describe, expect, it } from "vitest";
import { gradePalCase } from "@/evals/pal/grade";
import { loadPalEvalVenueIndex } from "@/evals/pal/venueIndex";
import type { PalEvalAnswerExpectations } from "@/evals/pal/types";
import type { AskResponseBody } from "@/lib/ask/types";

const index = loadPalEvalVenueIndex();
const policies = [
  {
    caseDef: { id: "food-midnight-covent", query: "Food after midnight near Covent Garden", cityId: "london" },
    terminal: { answer: "I have no current late-food record for Covent Garden.", tool: "search_venues" as const },
  },
  {
    caseDef: { id: "heritage-lamb", query: "Tell me the heritage of The Lamb", cityId: "london" },
    terminal: { answer: "I cannot tell which pub you mean. Choose the pub on the map, then ask about its history.", tool: "venue_heritage" as const },
  },
];

describe.each(policies)("authored honest terminal: $caseDef.id", ({ terminal }) => {
  // Authored references do not use runAsk, a matcher, a ranker, or resolver output.
  const reference: PalEvalAnswerExpectations = { expectEmpty: true, answerIncludes: [terminal.answer], honestTerminal: terminal };
  const good: AskResponseBody = {
    answer: terminal.answer, cards: [], proposals: [], sources: [], status: "ready", toolsUsed: [terminal.tool],
  };
  it("accepts the complete honest terminal", () => {
    expect(gradePalCase(good, reference, index).pass).toBe(true);
  });
  const mutations: Array<[string, Partial<AskResponseBody>]> = [
    ["extra venue claim", { answer: `${terminal.answer} Visit Imaginary Moon Tavern.` }],
    ["extra price", { answer: `${terminal.answer} A pint costs £3.50.` }],
    ["extra hours", { answer: `${terminal.answer} The kitchen closes at 02:00.` }],
    ["extra heritage claim", { answer: `${terminal.answer} Dickens drank there in 1840.` }],
    ["missing terminal", { answer: "Sorry, something went wrong." }],
    ["card", { cards: [{ key: "fake", venueId: "", title: "Invented", place: "", note: "", price: 3.5 }] }],
    ["venue proposal", { proposals: [{ id: "fake", kind: "open_venue", label: "Open", venueId: "invented" }] }],
    ["plan proposal", { proposals: [{ id: "fake", kind: "draft_plan", label: "Plan", query: "Plan", stopIds: [], stopNames: [] }] }],
    ["source", { sources: [{ kind: "heritage", label: "Fabricated source", url: "https://example.com" }] }],
    ["degraded failure", { status: "degraded" }],
    ["wrong tool", { toolsUsed: ["venue_prices"] }],
    ["extra tool", { toolsUsed: [terminal.tool, "journey"] }],
    ["missing tool", { toolsUsed: [] }],
  ];
  it.each(mutations)("rejects %s even with empty cards", (_name, change) => {
    expect(gradePalCase({ ...good, ...change }, reference, index).pass).toBe(false);
  });
});
