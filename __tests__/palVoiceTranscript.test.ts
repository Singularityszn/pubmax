import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PAL_VOICE_SOUND_SRC } from "@/components/pubpal/palVoiceSounds";

import {
  appendPalVoiceLine,
  correctPalVoiceLine,
  palAsksForMap,
  palAsksForNextStop,
  palVoiceMapIntent,
  palNextStop,
  palNightStopsFrom,
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

describe("map requests that still need an answer", () => {
  it.each([
    "Find me four pubs in Soho and show them on the map.",
    "Show me quiet pubs in Soho on the map",
    "Show me Soho on the map",
    "Show me the map with four cheap pubs near Bank",
  ])("keeps discovery in the conversation: %s", (query) => {
    expect(palVoiceMapIntent(query, false)).toBeNull();
  });
});

describe("the voice transcript", () => {
  it("drops empty lines and a Pal line sent twice", () => {
    const first = appendPalVoiceLine([], palVoiceLine("pal", "Evening."));
    expect(appendPalVoiceLine(first, palVoiceLine("pal", "  "))).toHaveLength(1);
    expect(appendPalVoiceLine(first, palVoiceLine("pal", "Evening."))).toHaveLength(1);
    expect(appendPalVoiceLine(first, palVoiceLine("you", "Evening."))).toHaveLength(2);
  });

  it("keeps the person saying the same thing twice", () => {
    const once = appendPalVoiceLine([], palVoiceLine("you", "Yes"));
    expect(appendPalVoiceLine(once, palVoiceLine("you", "Yes")).map((line) => line.text)).toEqual(["Yes", "Yes"]);
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

describe("the voice panel cues", () => {
  it("ships every cue it plays, as a small same-origin file", () => {
    for (const src of Object.values(PAL_VOICE_SOUND_SRC)) {
      expect(src.startsWith("/sounds/pal/")).toBe(true);
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), src).toBe(true);
      // A cue is a blip, not a track: anything larger was not trimmed.
      expect(statSync(file).size, src).toBeLessThan(40_000);
    }
  });
});

// One table for every line the voice panel can act on, so a rule change is
// read against all the others at once. Each row: the line, what it means with
// a night on, and what it means with no night on.
const VOICE_MAP_TABLE: ReadonlyArray<readonly [string, "next-stop" | "map" | null, "map" | null]> = [
  // Next-stop asks.
  ["Next stop", "next-stop", null],
  ["What's next?", "next-stop", null],
  ["where to next", "next-stop", null],
  ["take me to the next pub", "next-stop", null],
  ["what's next tonight", "next-stop", null],
  // "Stop" inside the ask is the noun, never a refusal.
  ["Next stop please", "next-stop", null],
  ["ok next stop then", "next-stop", null],
  // Map asks.
  ["Open the map", "map", "map"],
  ["map please", "map", "map"],
  ["can you show me the pub map", "map", "map"],
  // A line that asks for both: the next stop wins while a night is on.
  ["Show me the map for the next stop", "next-stop", "map"],
  ["open the map, where to next?", "next-stop", "map"],
  // Another day, before or after the ask.
  ["What's next tomorrow?", null, null],
  ["Tomorrow, what's next?", null, null],
  ["where next weekend", null, null],
  ["on Friday where to next", null, null],
  // A refusal, before or after the ask.
  ["Don't take me to the next stop yet", null, null],
  ["not the next pub", null, null],
  ["What is next, but do not open it yet?", null, null],
  ["what's next? don't open it", null, null],
  ["where to next, no need to show me", null, null],
  ["don't show me the map", null, null],
  ["not the map yet", null, null],
  // Not an ask at all.
  ["I liked this stop", null, null],
  ["stop", null, null],
  ["next week maybe", null, null],
  ["tell me about this pub", null, null],
];

describe("what the voice panel does with a line", () => {
  it.each(VOICE_MAP_TABLE)("%s", (line, withNight, withoutNight) => {
    expect(palVoiceMapIntent(line, true)).toBe(withNight);
    expect(palVoiceMapIntent(line, false)).toBe(withoutNight);
  });
});

describe("the next stop of a night", () => {
  it("hears the ways a person asks for the next stop", () => {
    for (const ask of ["Next stop", "take me to the next pub", "Where next?", "where's next", "where to next", "What's next?", "what's next tonight", "next pub this time of night"]) {
      expect(palAsksForNextStop(ask)).toBe(true);
    }
  });

  it("does not hear a refusal, or a sentence about something else", () => {
    for (const line of ["Don't take me to the next stop yet", "not the next pub", "I liked this stop", "next week maybe", "stop"]) {
      expect(palAsksForNextStop(line)).toBe(false);
    }
  });

  it("does not hear a question about another day", () => {
    for (const line of ["What's next tomorrow?", "what's next week", "where next weekend", "what is next on Saturday", "Tomorrow, what's next?", "on Friday where to next"]) {
      expect(palAsksForNextStop(line)).toBe(false);
    }
  });

  it("goes to the stop after the person's own cursor, and stays on the last", () => {
    const stops = [
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-b", venueName: "B" },
      { venueId: "venue c", venueName: "C" },
    ];
    expect(palNextStop(stops, 0)).toEqual({ href: "/map?sel=venue-b", venueName: "B" });
    expect(palNextStop(stops, 1)).toEqual({ href: "/map?sel=venue%20c", venueName: "C" });
    expect(palNextStop(stops, 2)).toEqual({ href: "/map?sel=venue%20c", venueName: "C" });
    expect(palNextStop(stops, -3)).toEqual({ href: "/map?sel=venue-b", venueName: "B" });
    expect(palNextStop([], 0)).toBeNull();
  });

  it("reads only well-formed stops from a plan body", () => {
    expect(palNightStopsFrom(null)).toEqual([]);
    expect(palNightStopsFrom({ stops: "x" })).toEqual([]);
    expect(palNightStopsFrom({ stops: [{ venueId: "v1", venueName: "One", position: 0 }, { venueId: 2 }, null] }))
      .toEqual([{ venueId: "v1", venueName: "One" }]);
  });
});
