import { describe, expect, it } from "vitest";

import {
  appendPalVoiceLine,
  correctPalVoiceLine,
  palAsksForMap,
  palVoiceLine,
  PAL_VOICE_TRANSCRIPT_MAX_LINES,
  tentativeUserTranscriptFrom,
} from "@/lib/palVoiceTranscript";

describe("palAsksForMap", () => {
  it.each([
    "Show me the map",
    "show me the map please",
    "Can you show the map?",
    "Open the map.",
    "open up the pub map",
    "Take me back to the map",
    "go to the map",
    "Pull up the map for me",
    "I want to see the map",
    "let me see the map",
    "Map",
    "the map please",
    "Show me Soho on the map",
    "Show me the map’s pubs",
  ])("hears an ask for the map: %s", (text) => {
    expect(palAsksForMap(text)).toBe(true);
  });

  it.each([
    "",
    "Don't show me the map yet",
    "do not open the map",
    "Is there a map of the crawl?",
    "What does the map show?",
    "Show me the roadmap",
    "Show me cheap pints near Soho",
    "Mapping out a big night",
    "The pub on the map looked busy",
  ])("leaves everything else to the Pal: %s", (text) => {
    expect(palAsksForMap(text)).toBe(false);
  });
});

describe("the voice transcript", () => {
  it("drops empty lines and an exact repeat of the last line", () => {
    const first = appendPalVoiceLine([], palVoiceLine("pal", "Evening."));
    expect(appendPalVoiceLine(first, palVoiceLine("pal", "  "))).toHaveLength(1);
    expect(appendPalVoiceLine(first, palVoiceLine("pal", "Evening."))).toHaveLength(1);
    expect(appendPalVoiceLine(first, palVoiceLine("you", "Evening."))).toHaveLength(2);
  });

  it("keeps the newest lines only", () => {
    let lines = appendPalVoiceLine([], palVoiceLine("you", "line 0"));
    for (let index = 1; index <= PAL_VOICE_TRANSCRIPT_MAX_LINES + 5; index += 1) {
      lines = appendPalVoiceLine(lines, palVoiceLine(index % 2 ? "pal" : "you", `line ${index}`));
    }
    expect(lines).toHaveLength(PAL_VOICE_TRANSCRIPT_MAX_LINES);
    expect(lines.at(-1)?.text).toBe(`line ${PAL_VOICE_TRANSCRIPT_MAX_LINES + 5}`);
  });

  it("corrects the newest matching Pal line and removes one cut to nothing", () => {
    const lines = [palVoiceLine("pal", "Long answer"), palVoiceLine("you", "Long answer"), palVoiceLine("pal", "Long answer")];
    const corrected = correctPalVoiceLine(lines, "Long answer", "Long");
    expect(corrected.map((line) => line.text)).toEqual(["Long answer", "Long answer", "Long"]);
    expect(correctPalVoiceLine(lines, "Long answer", "").map((line) => line.speaker)).toEqual(["pal", "you"]);
    expect(correctPalVoiceLine(lines, "Something else", "x")).toEqual(lines);
  });

  it("reads the tentative transcript and nothing else from the raw event", () => {
    expect(tentativeUserTranscriptFrom({
      type: "tentative_user_transcript",
      tentative_user_transcription_event: { user_transcript: " cheap pints " },
    })).toBe("cheap pints");
    expect(tentativeUserTranscriptFrom({ type: "ping" })).toBeNull();
    expect(tentativeUserTranscriptFrom(null)).toBeNull();
    expect(tentativeUserTranscriptFrom({ type: "tentative_user_transcript" })).toBeNull();
  });
});
