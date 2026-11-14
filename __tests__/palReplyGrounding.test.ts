import { describe, expect, it } from "vitest";

import { palReplyStreamGate, unsupportedPalReplyClaims } from "@/lib/palReplyGrounding";

describe("unsupportedPalReplyClaims", () => {
  it.each([
    "I cannot confirm the hours. Check the door when you arrive.",
    "Three pubs, a 1500 metre walk, 10 minutes apart.",
    "Which area would suit you?",
  ])("keeps conversation without record-rendered facts: %s", (reply) => {
    expect(unsupportedPalReplyClaims(reply)).toEqual([]);
  });

  it.each([
    ["price", "A pint is £4.50 there."],
    ["price", "The Coach charges £6 a pint."],
    ["price", "The Coach charges £4.80 a pint."],
    ["price", "Halves are 90p."],
    ["price", "Halves are 90 pence."],
    ["price", "Pints are under five pounds."],
    ["time", "The Coach closes at 11pm."],
    ["time", "Last orders at 10.45pm."],
    ["time", "It opens at 09:00."],
    ["time", "It is open until 11."],
    ["time", "It closes at half eleven."],
    ["time", "Doors open at noon."],
    ["date", "The quiz is on 21 November."],
    ["year", "It dates from 1720."],
  ])("requires the record renderer for a %s", (kind, reply) => {
    expect(unsupportedPalReplyClaims(reply)).toEqual([kind]);
  });
});

describe("palReplyStreamGate", () => {
  it("releases whole checked sentences and nothing after a factual figure", () => {
    const gate = palReplyStreamGate();
    expect(gate.push("Let me check. A pint is £4.")).toBe("Let me check.");
    expect(gate.push("80 there. Enjoy. ")).toBe("");
    expect(gate.push("More text. ")).toBe("");
    expect(gate.rest()).toBe("");
    expect(gate.shown).toBe(true);
  });

  it("checks an unfinished final sentence before releasing it", () => {
    const gate = palReplyStreamGate();
    expect(gate.push("The Crown charges £6")).toBe("");
    expect(gate.rest()).toBe("");
    expect(gate.shown).toBe(false);
  });
});
