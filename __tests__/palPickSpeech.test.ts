import { describe, expect, it } from "vitest";

import { createPalPickSpeech } from "@/lib/palPickSpeech";

const PICKS = [
  { number: 1, name: "The Queen's Head" },
  { number: 2, name: "The Coach & Horses" },
  { number: 3, name: "Lyceum Tavern" },
];

/** One aligned chunk: each character 50 ms after the last. */
function chunk(event_id: number, text: string) {
  const chars = [...text];
  return { event_id, alignment: { chars, char_start_times_ms: chars.map((_, index) => index * 50) } };
}

describe("which pick the Pal is naming", () => {
  it("cues a pick when its name starts to play, at that character's time", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "First, the Queen's Head at five twenty."), PICKS)).toEqual([{ number: 1, delayMs: 11 * 50 }]);
  });

  it("cues a name split across two chunks at once, because it is already being heard", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Next is Lyce"), PICKS)).toEqual([]);
    expect(speech.play(chunk(1, "um Tavern."), PICKS)).toEqual([{ number: 3, delayMs: 0 }]);
  });

  it("reads '&' as 'and' and drops a leading 'the'", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Try Coach and Horses."), PICKS)).toEqual([{ number: 2, delayMs: 4 * 50 }]);
  });

  it("cues repeated mentions without replaying processed occurrences", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Queen's Head. "), PICKS)).toHaveLength(1);
    expect(speech.play(chunk(1, "Lyceum Tavern. "), PICKS)).toEqual([{ number: 3, delayMs: 0 }]);
    expect(speech.play(chunk(1, "Yes, the Queen's Head."), PICKS)).toEqual([{ number: 1, delayMs: 9 * 50 }]);
    expect(speech.play(chunk(1, " Enjoy."), PICKS)).toEqual([]);
    expect(speech.play(chunk(2, "Queen's Head again."), PICKS)).toEqual([{ number: 1, delayMs: 0 }]);
  });

  it("cues every occurrence within a single chunk", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Queen's Head, Queen's Head."), PICKS)).toEqual([
      { number: 1, delayMs: 0 }, { number: 1, delayMs: 14 * 50 },
    ]);
  });

  it.each([false, true])("selects the most specific overlapping name regardless of pick order: %s", (reverse) => {
    const speech = createPalPickSpeech();
    const picks = [{ number: 1, name: "The Crown & Two Chairmen" }, { number: 2, name: "The Crown" }];
    if (reverse) picks.reverse();
    expect(speech.play(chunk(1, "The Crown and Two Chairmen. The Crown."), picks)).toEqual([
      { number: 1, delayMs: 4 * 50 }, { number: 2, delayMs: 32 * 50 },
    ]);
    expect(speech.play(chunk(1, " Enjoy."), picks)).toEqual([]);
  });

  it("resolves overlapping names completed across chunks", () => {
    const speech = createPalPickSpeech();
    const picks = [{ number: 1, name: "The Crown & Two Chairmen" }, { number: 2, name: "The Crown" }];
    expect(speech.play(chunk(1, "The Cr"), picks)).toEqual([]);
    expect(speech.play(chunk(1, "own and Two Chairmen."), picks)).toEqual([{ number: 1, delayMs: 0 }]);
    expect(speech.play(chunk(1, " The Crown."), picks)).toEqual([{ number: 2, delayMs: 5 * 50 }]);
  });

  it("cues the longer name when a later chunk completes an already-cued shorter name", () => {
    const speech = createPalPickSpeech();
    const picks = [{ number: 1, name: "The Crown & Two Chairmen" }, { number: 2, name: "The Crown" }];
    expect(speech.play(chunk(1, "The Crown "), picks)).toEqual([{ number: 2, delayMs: 4 * 50 }]);
    expect(speech.play(chunk(1, "and Two Chairmen."), picks)).toEqual([{ number: 1, delayMs: 0 }]);
    expect(speech.play(chunk(1, " Enjoy."), picks)).toEqual([]);
  });

  it("forgets processed occurrences after an interruption", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Queen's Head."), PICKS)).toEqual([{ number: 1, delayMs: 0 }]);
    speech.reset();
    expect(speech.play(chunk(1, "Queen's Head."), PICKS)).toEqual([{ number: 1, delayMs: 0 }]);
  });

  it("never cues a word that only contains a name", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Overheads and queenly towers."), [{ number: 1, name: "Heads" }])).toEqual([]);
  });

  it("orders cues by when they play", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Lyceum Tavern or Queen's Head"), PICKS).map((cue) => cue.number)).toEqual([3, 1]);
  });
});
