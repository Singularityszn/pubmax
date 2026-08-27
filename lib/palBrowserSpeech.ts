import type {
  SpeechRecognitionCtor,
  SpeechRecognitionLike,
} from "@/lib/pintDropSpeech";

type SpeechUtteranceLike = {
  lang: string;
  rate: number;
  text: string;
};

type SpeechUtteranceCtor = new (text: string) => SpeechUtteranceLike;

export type PalBrowserSpeechScope = {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  speechSynthesis?: {
    cancel: () => void;
    speak: (utterance: SpeechUtteranceLike) => void;
  };
  SpeechSynthesisUtterance?: SpeechUtteranceCtor;
};

type RecognitionHandlers = {
  onTranscript: (text: string) => void;
  onError: () => void;
  onEnd: () => void;
};

function browserScope(): PalBrowserSpeechScope {
  return typeof window === "undefined"
    ? {}
    : window as unknown as PalBrowserSpeechScope;
}

export function browserSpeechAvailability(
  scope: PalBrowserSpeechScope = browserScope(),
): "available" | "unavailable" {
  return scope.SpeechRecognition || scope.webkitSpeechRecognition
    ? "available"
    : "unavailable";
}

export function createOneShotRecognition(
  scope: PalBrowserSpeechScope,
  handlers: RecognitionHandlers,
): SpeechRecognitionLike | null {
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = "en-GB";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onerror = handlers.onError;
  recognition.onend = handlers.onEnd;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result?.isFinal) continue;
      const transcript = result[0]?.transcript.trim() ?? "";
      if (transcript) handlers.onTranscript(transcript);
      recognition.stop();
      return;
    }
  };
  return recognition;
}

export function speakPalAnswer(
  text: string,
  scope: PalBrowserSpeechScope = browserScope(),
): boolean {
  const clean = text.trim();
  if (!clean || !scope.speechSynthesis || !scope.SpeechSynthesisUtterance) return false;

  const utterance = new scope.SpeechSynthesisUtterance(clean);
  utterance.lang = "en-GB";
  utterance.rate = 0.96;
  scope.speechSynthesis.cancel();
  scope.speechSynthesis.speak(utterance);
  return true;
}
