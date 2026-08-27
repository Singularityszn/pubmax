import { describe, expect, it, vi } from "vitest";

import {
  browserSpeechAvailability,
  createOneShotRecognition,
  speakPalAnswer,
} from "@/lib/palBrowserSpeech";

class FakeRecognition {
  lang = "";
  interimResults = true;
  continuous = true;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

describe("Pal browser speech", () => {
  it("detects recognition without assuming one browser prefix", () => {
    expect(browserSpeechAvailability({})).toBe("unavailable");
    expect(browserSpeechAvailability({ webkitSpeechRecognition: FakeRecognition })).toBe("available");
  });

  it("configures one final British-English transcript", () => {
    const onTranscript = vi.fn();
    const recognition = createOneShotRecognition(
      { SpeechRecognition: FakeRecognition },
      { onTranscript, onError: vi.fn(), onEnd: vi.fn() },
    ) as FakeRecognition;

    expect(recognition.lang).toBe("en-GB");
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(false);
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: "  quiet pub in Soho  " }, isFinal: true }],
    });
    expect(onTranscript).toHaveBeenCalledWith("quiet pub in Soho");
    expect(recognition.stop).toHaveBeenCalledOnce();
  });

  it("reads an answer aloud only when synthesis is available", () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class FakeUtterance {
      lang = "";
      rate = 0;
      constructor(public text: string) {}
    }
    expect(speakPalAnswer("Try The Lamb.", {
      speechSynthesis: { speak, cancel },
      SpeechSynthesisUtterance: FakeUtterance,
    })).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledOnce();
    expect((speak.mock.calls[0][0] as FakeUtterance).lang).toBe("en-GB");
    expect(speakPalAnswer("No audio", {})).toBe(false);
  });
});
