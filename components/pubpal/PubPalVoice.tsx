"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { Mic, MicOff, Send } from "lucide-react";
import { authedFetch } from "@/lib/authedFetch";
import type { PalAnimationState } from "@/lib/pubPal";
import type { PalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";

type VoiceTokenResponse = {
  signedUrl?: string;
  overrides?: PalVoiceOverrides;
  maxSessionSeconds?: number;
  error?: string;
};

async function releaseVoiceSession(durationSeconds: number): Promise<void> {
  try {
    await authedFetch("/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", durationSeconds }),
    });
  } catch {
    // Best effort: a failed release must not block ending the local session.
  }
}

function VoiceControls({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const connectedAtRef = useRef<number | null>(null);
  const releasedRef = useRef(false);
  const capTimerRef = useRef<number | null>(null);

  const finalizeSession = useCallback(async (connected: boolean) => {
    if (releasedRef.current) return;
    releasedRef.current = true;
    if (capTimerRef.current) {
      window.clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    const durationSeconds = connected && connectedAtRef.current
      ? Math.round((Date.now() - connectedAtRef.current) / 1000)
      : 0;
    connectedAtRef.current = null;
    await releaseVoiceSession(durationSeconds);
  }, []);

  useEffect(() => {
    if (status !== "connected") onStateChange?.("idle");
    else if (isSpeaking) onStateChange?.("speaking");
    else if (isListening) onStateChange?.("listening");
  }, [isListening, isSpeaking, onStateChange, status]);

  const stop = useCallback(async () => {
    const connected = status === "connected";
    endSession();
    await finalizeSession(connected);
    onStateChange?.("idle");
  }, [endSession, finalizeSession, onStateChange, status]);

  const start = async () => {
    setError(null);
    releasedRef.current = false;
    connectedAtRef.current = null;
    onStateChange?.("noticing");
    try {
      const response = await authedFetch("/api/pub-pal/voice-token", { method: "POST" });
      const body = await response.json() as VoiceTokenResponse;
      if (!response.ok || !body.signedUrl) {
        setError(body.error ?? "Voice is unavailable. Use text instead.");
        onStateChange?.("error");
        return;
      }

      const maxSessionSeconds = body.maxSessionSeconds ?? PAL_VOICE_MAX_SESSION_SECONDS;
      const overrides = body.overrides;

      startSession({
        signedUrl: body.signedUrl,
        connectionType: "websocket",
        overrides: overrides
          ? {
              agent: {
                prompt: { prompt: overrides.systemPrompt },
                firstMessage: overrides.firstMessage,
              },
              ...(overrides.voiceId
                ? { tts: { voiceId: overrides.voiceId } }
                : {}),
            }
          : undefined,
        onConnect: () => {
          connectedAtRef.current = Date.now();
          capTimerRef.current = window.setTimeout(() => {
            void stop();
          }, maxSessionSeconds * 1000);
        },
        onDisconnect: () => {
          void finalizeSession(connectedAtRef.current !== null);
        },
        onError: (message) => {
          setError(String(message));
          onStateChange?.("error");
          void finalizeSession(connectedAtRef.current !== null);
        },
      });
    } catch {
      setError("Voice is unavailable. Use text instead.");
      onStateChange?.("error");
      await releaseVoiceSession(0);
    }
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    onStateChange?.("thinking");
    sendUserMessage(value);
    setText("");
  };

  return (
    <div className="palVoice">
      <div className="palVoiceStatus" role="status">
        <i className={status === "connected" ? "isLive" : ""} />
        {status === "connected" ? "Pal is listening" : "Voice ready when you are"}
      </div>
      <div className="palVoiceActions">
        {status === "connected" ? (
          <button type="button" onClick={() => { void stop(); }}>
            <MicOff size={18} /> End
          </button>
        ) : (
          <button type="button" onClick={() => { void start(); }}>
            <Mic size={18} /> Start voice chat
          </button>
        )}
        <label>
          <span className="srOnly">Message your Pub Pal</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") send(); }}
            placeholder="Or type the night you want…"
          />
          <button type="button" onClick={send} aria-label="Send message">
            <Send size={17} />
          </button>
        </label>
      </div>
      {error && <p className="palVoiceError" role="alert">{error}</p>}
      <p className="palVoicePrivacy">
        No audio or transcript becomes memory. The Pal proposes facts for you to approve separately.
      </p>
    </div>
  );
}

export default function PubPalVoice({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  return (
    <ConversationProvider>
      <VoiceControls onStateChange={onStateChange} />
    </ConversationProvider>
  );
}
