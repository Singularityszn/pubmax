"use client";

import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  browserSpeechAvailability,
  createOneShotRecognition,
} from "@/lib/palBrowserSpeech";
import type { SpeechRecognitionLike } from "@/lib/pintDropSpeech";

type TalkState = "checking" | "idle" | "listening" | "captured" | "unavailable" | "error";

export default function PalTalkControl({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<TalkState>("checking");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState(browserSpeechAvailability() === "available" ? "idle" : "unavailable");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      recognitionRef.current?.stop();
    };
  }, []);

  const start = () => {
    if (state === "listening") {
      recognitionRef.current?.stop();
      setState("idle");
      return;
    }
    const recognition = createOneShotRecognition(
      window as unknown as Parameters<typeof createOneShotRecognition>[0],
      {
        onTranscript: (text) => {
          onTranscript(text);
          setState("captured");
        },
        onError: () => setState("error"),
        onEnd: () => setState((current) => current === "listening" ? "idle" : current),
      },
    );
    if (!recognition) {
      setState("unavailable");
      return;
    }
    recognitionRef.current = recognition;
    setState("listening");
    try {
      recognition.start();
    } catch {
      setState("error");
    }
  };

  const disabled = state === "checking" || state === "unavailable";
  const line = state === "listening"
    ? "Listening. Tap to stop."
    : state === "captured"
      ? "Review the text, then press Ask."
      : state === "error"
        ? "Microphone unavailable. Type instead."
        : state === "unavailable"
          ? "Talk is unavailable here. Type instead."
          : "Speech becomes reviewable text.";

  return (
    <div className="palTalkControl">
      <button
        className="palTalkButton pressable"
        type="button"
        disabled={disabled}
        aria-pressed={state === "listening"}
        onClick={start}
      >
        {state === "unavailable" || state === "error"
          ? <MicOff size={18} aria-hidden="true" />
          : <Mic size={18} aria-hidden="true" />}
        {state === "listening" ? "Stop listening" : "Speak your question"}
      </button>
      <p aria-live="polite">{line}</p>
    </div>
  );
}
