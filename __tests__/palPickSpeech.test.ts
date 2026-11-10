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

  it("cues each pick once per reply, and again in the next reply", () => {
    const speech = createPalPickSpeech();
    expect(speech.play(chunk(1, "Queen's Head. "), PICKS)).toHaveLength(1);
    expect(speech.play(chunk(1, "Yes, the Queen's Head."), PICKS)).toEqual([]);
    expect(speech.play(chunk(2, "Queen's Head again."), PICKS)).toEqual([{ number: 1, delayMs: 0 }]);
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
