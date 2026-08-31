import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "@/lib/pintDropSpeech";
import type { PalGuestMode } from "@/lib/palGuestTrial";

export type PalBrowserRecognitionHandlers = {
  onTranscript: (transcript: string) => void;
  onError: () => void;
  onEnd: () => void;
};

/**
 * Creates a browser-owned, one-shot recognition session. The caller starts it
 * only after an explicit action. Audio and transcripts are never persisted.
 */
export function createPalBrowserRecognition(
  handlers: PalBrowserRecognitionHandlers,
): SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    handlers.onError();
    return null;
  }

  recognition.lang = "en-GB";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const finalParts: string[] = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalParts.push(result[0].transcript);
    }
    const transcript = finalParts.join(" ").trim();
    if (transcript) handlers.onTranscript(transcript);
  };
  recognition.onerror = handlers.onError;
  recognition.onend = handlers.onEnd;
  return recognition;
}

/** Browser speech synthesis for Talk mode. No provider grant or credential. */
export function speakPalBrowserAnswer(
  text: string,
  mode: PalGuestMode,
): boolean {
  const message = text.trim();
  if (
    mode !== "talk" ||
    !message ||
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "en-GB";
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopPalBrowserSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Browser speech is optional. Failure must not block text chat.
  }
}
