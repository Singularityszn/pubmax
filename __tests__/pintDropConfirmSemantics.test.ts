// WHAT A CONFIRM MEANS, AND WHAT A DIFFERENT PRICE MEANS (captain 7 Sept 2026).
//
// The door on a split pub asks "Which did you pay?" and offers each recorded
// figure. The answer to that question is decided on the SERVER and nowhere
// else, and this file pins the two halves of it:
//
//   - a report that MATCHES a recorded figure exactly, for the same drink and
//     measure, from an independent reporter, mints a confirmation;
//   - a report that does NOT match is a third drop. Nothing is confirmed, and
//     the drinker is told what the pub now holds rather than shown a line
//     asking for a second drinker who has already been.
//
// The write path answers with the closed vocabulary in
// lib/pintDropSecondDrinker.ts, and the composer's receipt prints the server's
// own answer rather than deciding one of its own.

import { describe, expect, it } from "vitest";

import {
  findSecondReporterConfirmation,
  outcomeForUnmintedReading,
  readSecondReporter,
  type ConfirmableDrop,
} from "@/lib/pintDropConfirmation";
import {
  PINT_DROP_CONFIRMATION_OUTCOMES,
  confirmationOutcomeLine,
  parseConfirmationOutcome,
} from "@/lib/pintDropSecondDrinker";
import { missionReceiptFromReadback } from "@/lib/priceEvidenceMissions";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-07T20:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function drop(overrides: Partial<ConfirmableDrop> = {}): ConfirmableDrop {
  return {
    id: "drop-1",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: daysAgo(1),
    handle: "tester",
    ...overrides,
  } as ConfirmableDrop;
}

/** The pub the split door is offered on: £4.50 and £4.70, two reporters. */
function splitLane(): ConfirmableDrop[] {
  return [
    drop({ id: "a", priceGbp: 4.7, handle: "first", authorityKey: "key-a" }),
    drop({
      id: "b",
      priceGbp: 4.5,
      handle: "second",
      authorityKey: "key-b",
      createdAt: daysAgo(2),
    }),
  ];
}

describe("a match confirms, and only a match", () => {
  it("mints when an independent reporter answers with the SAME figure", () => {
    const answered = [
      ...splitLane(),
      drop({ id: "c", priceGbp: 4.5, handle: "third", authorityKey: "key-c" }),
    ];
    const pair = findSecondReporterConfirmation(answered, NOW);
    expect(pair).not.toBeNull();
    expect(new Set([pair?.dropId, pair?.confirmingDropId])).toEqual(new Set(["b", "c"]));
  });

  it("mints nothing when the answer is a different figure, and says what the pub holds", () => {
    const third = [
      ...splitLane(),
      drop({ id: "c", priceGbp: 5.1, handle: "third", authorityKey: "key-c" }),
    ];
    expect(findSecondReporterConfirmation(third, NOW)).toBeNull();
    const reading = readSecondReporter(third, NOW, "key-c");
    expect(reading).toEqual({ kind: "split", prices: [4.5, 4.7, 5.1], reporters: 3 });
  });

  it("names the split for the caller who has just joined one", () => {
    expect(readSecondReporter(splitLane(), NOW, "key-b")).toEqual({
      kind: "split",
      prices: [4.5, 4.7],
      reporters: 2,
    });
    // One report is still one report: a lone drinker has joined no split.
    expect(readSecondReporter([drop({ authorityKey: "key-a" })], NOW, "key-a")).toEqual({
      kind: "awaiting",
    });
  });

  it("still tells a repeating account it repeated itself, before it mentions a split", () => {
    // The same key twice on £4.50, plus somebody else's £4.70. `same_reporter`
    // is a sentence about the caller and outranks the pub's own disagreement.
    const repeated = [
      drop({ id: "a", priceGbp: 4.5, authorityKey: "key-a" }),
      drop({ id: "b", priceGbp: 4.5, authorityKey: "key-a", createdAt: daysAgo(3) }),
      drop({ id: "c", priceGbp: 4.7, authorityKey: "key-b", createdAt: daysAgo(2) }),
    ];
    expect(readSecondReporter(repeated, NOW, "key-a")).toEqual({ kind: "same_reporter" });
  });
});

describe("the closed vocabulary carries the answer to the browser", () => {
  it("names the split outcome and keeps the set closed", () => {
    expect(PINT_DROP_CONFIRMATION_OUTCOMES).toContain("price_disagrees");
    expect(
      outcomeForUnmintedReading({ kind: "split", prices: [4.5, 4.7], reporters: 3 }),
    ).toEqual({ status: "price_disagrees", prices: [4.5, 4.7], reporters: 3 });
  });

  it("reads the outcome back off a response body, and refuses a malformed one", () => {
    expect(
      parseConfirmationOutcome({ status: "price_disagrees", prices: [4.5, 4.7], reporters: 2 }),
    ).toEqual({ status: "price_disagrees", prices: [4.5, 4.7], reporters: 2 });
    expect(parseConfirmationOutcome({ status: "price_disagrees" })).toBeNull();
    expect(parseConfirmationOutcome({ status: "price_disagrees", prices: [] })).toBeNull();
  });

  it("words it as a fact about the pub and a rule, never as a refusal", () => {
    const line = confirmationOutcomeLine(
      { status: "price_disagrees", prices: [4.5, 4.7], reporters: 2 },
      4.7,
    );
    expect(line).toBe(
      "Two drinkers, two prices: £4.50 and £4.70. A price is confirmed when two drinkers report the same figure.",
    );
    // The two counts come apart, and the line says both: three reports holding
    // two figures is three drinkers and two prices.
    expect(
      confirmationOutcomeLine(
        { status: "price_disagrees", prices: [4.5, 4.7], reporters: 3 },
        4.7,
      ),
    ).toBe(
      "Three drinkers, two prices: £4.50 and £4.70. A price is confirmed when two drinkers report the same figure.",
    );
  });
});

describe("the quick composer's receipt reads the same state", () => {
  it("tells a split pub apart from a pub nothing speaks for", () => {
    const beer = { drinkCategory: "beer", submittedAt: NOW, corroborations: 1 };
    expect(
      missionReceiptFromReadback({
        price: beer as never,
        pintTrust: "disputed",
        now: NOW,
      }),
    ).toEqual({
      outcome: "needs_check",
      line: "Drinkers here report different prices. A second drinker reporting the same figure confirms it.",
    });
    expect(
      missionReceiptFromReadback({ price: beer as never, pintTrust: "none", now: NOW }),
    ).toEqual({ outcome: "logged", line: "Logged." });
  });
});
