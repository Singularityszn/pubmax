// Minimal, feature-detected typings for the Web Speech API — not in lib.dom.d.ts.
type SpeechRecognitionResultLike = { 0: { transcript: string }; isFinal: boolean };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

// A continuous session's `results` holds every phrase since start(), and
// `resultIndex` is only the first one that changed. Reading from resultIndex
// drops the phrases already finished, so the whole list is joined each time.
export function speechSessionTranscript(event: SpeechRecognitionEventLike): string {
  const parts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const piece = event.results[index]?.[0]?.transcript?.trim();
    if (piece) parts.push(piece);
  }
  return parts.join(" ");
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
