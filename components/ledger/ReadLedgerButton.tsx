"use client";

import { useCallback, useState } from "react";

import "./readLedgerButton.css";

// The Ledger's voice affordance (issue #25): "Read this page" for the
// Boomer/Gen-X reading surface, using the Web Speech API's speechSynthesis —
// no new dependency. Feature-detected: on a browser/runtime without
// speechSynthesis this renders nothing at all, never a dead button.
//
// React 19 hygiene: speaking state is only ever set from event handlers
// (click, and the utterance's onend/onerror callbacks), never from an effect
// body, so this stays clear of react-hooks/set-state-in-effect.

type ReadLedgerButtonProps = {
  // The full text to read aloud — composed server-side by the page (venue
  // name, heritage note, latest entries) so this component stays a dumb,
  // reusable "speak this string" control.
  text: string;
};

export default function ReadLedgerButton({ text }: ReadLedgerButtonProps) {
  // Lazily feature-detect once. Only reachable in the browser (this is a
  // client component); on the server useState's initializer never runs.
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [speaking, setSpeaking] = useState(false);

  const handleRead = useCallback(() => {
    if (!supported || !text.trim()) return;
    try {
      window.speechSynthesis.cancel(); // clear anything already queued
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
    }
  }, [supported, text]);

  const handleStop = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
    } finally {
      setSpeaking(false);
    }
  }, [supported]);

  if (!supported) return null;

  return (
    <button
      type="button"
      className="ledgerReadButton"
      onClick={speaking ? handleStop : handleRead}
      aria-pressed={speaking}
    >
      {speaking ? "Stop reading" : "Read this page"}
    </button>
  );
}
