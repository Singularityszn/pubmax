import { describe, expect, it } from "vitest";

import { getSpeechRecognitionCtor, speechSessionTranscript } from "@/lib/pintDropSpeech";
import { VISIBILITY_COPY } from "@/lib/pintDropComposerConfig";
import { VISIBILITIES } from "@/lib/spill";

// Node env (no DOM): window is undefined, so the feature-detection guard should
// short-circuit to null rather than throwing.
describe("getSpeechRecognitionCtor", () => {
  it("returns null when window is undefined (server / node env)", () => {
    expect(typeof window).toBe("undefined");
    expect(getSpeechRecognitionCtor()).toBeNull();
  });
});

describe("speechSessionTranscript", () => {
  const result = (transcript: string, isFinal = true) => ({ 0: { transcript }, isFinal });

  it("keeps the phrases a continuous session already finished", () => {
    // Chrome sends resultIndex 1 here: only the second phrase changed.
    const event = {
      resultIndex: 1,
      results: [result("cheap pint"), result(" near Soho", false)],
    };
    expect(speechSessionTranscript(event)).toBe("cheap pint near Soho");
  });

  it("joins phrases with one space and skips empty ones", () => {
    const event = { resultIndex: 0, results: [result("  the Lamb "), result(""), result("tonight")] };
    expect(speechSessionTranscript(event)).toBe("the Lamb tonight");
  });

  it("returns an empty string before anything is heard", () => {
    expect(speechSessionTranscript({ resultIndex: 0, results: [] })).toBe("");
  });
});

describe("VISIBILITY_COPY", () => {
  it("covers every visibility lane with a label + helper", () => {
    for (const v of VISIBILITIES) {
      expect(VISIBILITY_COPY[v]).toBeDefined();
      expect(VISIBILITY_COPY[v].label).toBeTruthy();
      expect(VISIBILITY_COPY[v].helper).toBeTruthy();
    }
  });
});
