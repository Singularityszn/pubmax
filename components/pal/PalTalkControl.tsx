"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createPalBrowserRecognition } from "@/lib/palBrowserSpeech";
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/pintDropSpeech";

type PalTalkControlProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
};

const TALK_ERROR = "Talk did not start. Type instead.";

export default function PalTalkControl({
  disabled = false,
  onChange,
}: PalTalkControlProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      // A browser can end a one-shot session before cleanup reaches it.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setSupported(getSpeechRecognitionCtor() !== null);
    });
    return () => {
      active = false;
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (!disabled) return;
    stop();
    const timer = window.setTimeout(() => {
      setListening(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [disabled, stop]);

  const start = useCallback(() => {
    if (disabled || listening) return;
    setError("");

    let recognition: SpeechRecognitionLike | null = null;
    recognition = createPalBrowserRecognition({
      onTranscript: (transcript) => {
        onChange(transcript);
        stop();
        setListening(false);
      },
      onError: () => {
        stop();
        setListening(false);
        setError(TALK_ERROR);
      },
      onEnd: () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        setListening(false);
      },
    });
    if (!recognition) {
      setSupported(false);
      return;
    }

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      stop();
      setListening(false);
      setError(TALK_ERROR);
    }
  }, [disabled, listening, onChange, stop]);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      setListening(false);
      return;
    }
    start();
  }, [listening, start, stop]);

  if (supported === null) return null;
  if (!supported) {
    return <p className="palTalkStatus" role="status">Talk is unavailable. Type instead.</p>;
  }

  return (
    <div className="palTalkControl">
      <button
        type="button"
        className="palTalkButton"
        disabled={disabled}
        aria-busy={listening || undefined}
        onClick={toggle}
        style={{ minHeight: 44, minWidth: 44 }}
      >
        {listening ? "Stop listening" : "Speak your question"}
      </button>
      {error ? <p className="palTalkStatus" role="status">{error}</p> : null}
    </div>
  );
}
