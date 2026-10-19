import { describe, expect, it } from "vitest";
import { palVoiceToolAnswer } from "@/lib/palVoiceToolAnswer";

const result = {
  ok: true, tool: "search_venues", answerHint: "Four listed pubs in Soho.",
  cards: [1, 2, 3, 4].map((number) => ({ key: `pub-${number}`, venueId: `venue-${number}`, title: `Pub ${number}`, place: "Soho", note: "", price: null, provenance: { kind: "directory", label: "On record" } })),
  proposals: [],
};
const event = { tool_name: "search_venues", tool_call_id: "search-1", is_error: false, is_called: true, full_tool_result: JSON.stringify({ result }) };

describe("voice tool display data", () => {
  it("shows the four real tool cards without parsing pub names from speech", () => {
    expect(palVoiceToolAnswer(event)?.cards.map((card) => card.venueId)).toEqual(["venue-1", "venue-2", "venue-3", "venue-4"]);
  });

  it.each([
    { ...event, is_error: true },
    { ...event, truncated: true },
    { ...event, tool_name: "recall_memories" },
    { ...event, full_tool_result: "Pub 1 has a pint for £1" },
    { ...event, full_tool_result: JSON.stringify({ result: { ...result, ok: false } }) },
  ])("does not invent cards from failed, private or incomplete data", (input) => {
    expect(palVoiceToolAnswer(input)).toBeNull();
  });
});
