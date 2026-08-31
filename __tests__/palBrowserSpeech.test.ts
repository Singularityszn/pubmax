// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPalBrowserRecognition,
  speakPalBrowserAnswer,
  stopPalBrowserSpeech,
} from "@/lib/palBrowserSpeech";
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from "@/lib/pintDropSpeech";

class FakeRecognition implements SpeechRecognitionLike {
  static latest: FakeRecognition | null = null;

  lang = "";
  interimResults = true;
  continuous = true;
  start = vi.fn();
  stop = vi.fn();
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;

  constructor() {
    FakeRecognition.latest = this;
  }
}

function recognitionEvent(
  transcript: string,
  isFinal = true,
): SpeechRecognitionEventLike {
  return {
    resultIndex: 0,
    results: [{ 0: { transcript }, isFinal }],
  };
}

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  vi.unstubAllGlobals();
  FakeRecognition.latest = null;
});

describe("Pub Pal browser speech", () => {
  it("creates one-shot en-GB recognition and returns only its final transcript", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();

    const recognition = createPalBrowserRecognition({
      onTranscript,
      onError,
      onEnd,
    });

    expect(recognition).toBeInstanceOf(FakeRecognition);
    expect(recognition?.lang).toBe("en-GB");
    expect(recognition?.interimResults).toBe(false);
    expect(recognition?.continuous).toBe(false);

    recognition?.onresult?.(recognitionEvent("  find somewhere quiet  ", false));
    expect(onTranscript).not.toHaveBeenCalled();
    recognition?.onresult?.(recognitionEvent("  find somewhere quiet  "));
    expect(onTranscript).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith("find somewhere quiet");
  });

  it("returns null without a browser recognition implementation", () => {
    expect(createPalBrowserRecognition({
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    })).toBeNull();
  });

  it("speaks a completed answer only when Talk mode is selected", () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel, speak },
    });
    class FakeUtterance {
      lang = "";
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    expect(speakPalBrowserAnswer("  Try The Lamb.  ", "text")).toBe(false);
    expect(speak).not.toHaveBeenCalled();

    expect(speakPalBrowserAnswer("  Try The Lamb.  ", "talk")).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0]).toMatchObject({
      text: "Try The Lamb.",
      lang: "en-GB",
    });

    stopPalBrowserSpeech();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("does not speak blank text or throw when synthesis is unavailable", () => {
    expect(speakPalBrowserAnswer("", "talk")).toBe(false);
    expect(() => stopPalBrowserSpeech()).not.toThrow();
  });
});
