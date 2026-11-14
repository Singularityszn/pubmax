import { describe, expect, it } from "vitest";

import { palReplyEvidence, palReplyStreamGate, unsupportedPalReplyClaims } from "@/lib/palReplyGrounding";

const record = JSON.stringify({
  cards: [{ title: "The Crown", price: 4.5, note: "Mo-Th 12:00-23:00; Fr-Sa 12:00-00:30. Built 1823." }],
  data: { events: [{ startsAt: "2026-07-03T19:30:00Z", estimateGbp: 6.25 }] },
});
const evidence = palReplyEvidence("Current user message: drinks after 7 with friends", [record]);

describe("unsupportedPalReplyClaims", () => {
  it.each([
    ["a recorded price", "A pint is £4.50 there."],
    ["a recorded estimate", "Around £6.25 is the zone estimate."],
    ["recorded hours in another form", "Open until 11pm, and until 12:30am on Fridays."],
    ["noon from a recorded 12:00", "Doors open at noon."],
    ["a zoned start in London time", "The quiz starts at 8.30pm on 3 July."],
    ["a recorded year", "It was built in 1823."],
    ["the person's own hour", "See you at 7pm."],
    ["no figures at all", "I cannot confirm the hours. Check the door when you arrive."],
    ["counts and distances", "Three pubs, a 1500 metre walk, 10 minutes apart."],
  ])("lets %s stand", (_label, reply) => {
    expect(unsupportedPalReplyClaims(reply, evidence)).toEqual([]);
  });

  it.each([
    ["price", "A pint is £3.80 there."],
    ["price", "Halves are 90p."],
    ["time", "Last orders at 10.45pm."],
    ["time", "It opens at 09:00."],
    ["date", "There is a quiz on 21st of November."],
    ["year", "It dates from 1720."],
  ])("refuses an unsourced %s", (kind, reply) => {
    expect(unsupportedPalReplyClaims(reply, evidence)).toEqual([kind]);
  });

  it.each([
    ["price", "The Coach charges £6 a pint.", palReplyEvidence("My budget is £6.", [])],
    ["price", "The Coach charges £4.80 a pint.", palReplyEvidence("Find a pub", [JSON.stringify({ name: "The Anchor", price: 4.8 })])],
    ["time", "The Coach closes at 11pm.", palReplyEvidence("We will arrive at 11pm.", [])],
    ["date", "The quiz is on 21 November.", palReplyEvidence("Find a quiz", [JSON.stringify({ priceReadAt: "2026-11-21T12:00:00Z" })])],
  ] as const)("refuses a %s borrowed from a different fact", (kind, reply, supplied) => {
    expect(unsupportedPalReplyClaims(reply, supplied)).toEqual([kind]);
  });

  it("does not read a price as a clock time", () => {
    expect(unsupportedPalReplyClaims("A pint is £4.50.", palReplyEvidence("", [JSON.stringify({ price: 4.5 })]))).toEqual([]);
  });
});

describe("palReplyStreamGate", () => {
  it("releases whole checked sentences and nothing after an unsupported figure", () => {
    const gate = palReplyStreamGate(evidence);
    expect(gate.push("The Crown is quiet. A pint is £4.")).toBe("The Crown is quiet.");
    expect(gate.push("50 there. Halves are 9")).toBe(" A pint is £4.50 there.");
    expect(gate.push("0p. Enjoy. ")).toBe("");
    expect(gate.push("More text. ")).toBe("");
    expect(gate.shown).toBe(true);
  });
});
