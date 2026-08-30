"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConversationProvider, useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { Mic, MicOff, Send } from "lucide-react";
import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { PalAnimationState } from "@/lib/pubPal";
import type { PalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import {
  createPubPalVoiceStartController,
  PAL_VOICE_START_ERROR,
  PubPalVoiceStartError,
} from "@/lib/pubPalVoiceSession";

type VoiceTokenResponse = {
  signedUrl?: string;
  overrides?: PalVoiceOverrides;
  maxSessionSeconds?: number;
  error?: string;
};

type VoiceGrant = Omit<VoiceTokenResponse, "signedUrl"> & { signedUrl: string };

async function releaseVoiceSession(durationSeconds: number): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", durationSeconds }),
    });
    discardBody(response);
  } catch {
    // Best effort: a failed release must not block ending the local session.
  }
}

function VoiceControls({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [text, setText] = useState("");
  const disposedRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const grantIssuedRef = useRef(false);
  const releasedRef = useRef(false);
  const sdkSessionStartedRef = useRef(false);
  const capTimerRef = useRef<number | null>(null);
  const [startController] = useState(createPubPalVoiceStartController);

  const finalizeSession = useCallback(async (connected: boolean) => {
    if (releasedRef.current) return;
    if (capTimerRef.current !== null) {
      window.clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
    const durationSeconds = connected && connectedAtRef.current
      ? Math.round((Date.now() - connectedAtRef.current) / 1000)
      : 0;
    connectedAtRef.current = null;
    if (!grantIssuedRef.current) return;
    releasedRef.current = true;
    await releaseVoiceSession(durationSeconds);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      startController.cancel();
      if (capTimerRef.current !== null) {
        window.clearTimeout(capTimerRef.current);
        capTimerRef.current = null;
      }
      if (sdkSessionStartedRef.current) {
        sdkSessionStartedRef.current = false;
        endSession();
      }
      void finalizeSession(connectedAtRef.current !== null);
    };
  }, [endSession, finalizeSession, startController]);

  useEffect(() => {
    if (status !== "connected") onStateChange?.("idle");
    else if (isSpeaking) onStateChange?.("speaking");
    else if (isListening) onStateChange?.("listening");
  }, [isListening, isSpeaking, onStateChange, status]);

  const stop = useCallback(async () => {
    if (disposedRef.current) return;
    const connected = status === "connected";
    startController.settle();
    setIsStarting(false);
    endSession();
    sdkSessionStartedRef.current = false;
    await finalizeSession(connected);
    if (!disposedRef.current) onStateChange?.("idle");
  }, [endSession, finalizeSession, onStateChange, startController, status]);

  const start = async () => {
    if (disposedRef.current) return;
    if (startController.isStarting()) return;
    setError(null);
    setIsStarting(true);
    grantIssuedRef.current = false;
    releasedRef.current = false;
    connectedAtRef.current = null;
    onStateChange?.("noticing");
    const started = await startController.start<VoiceGrant>({
      requestMicrophone: async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new PubPalVoiceStartError("Microphone is unavailable. Use text instead.");
        }
        return navigator.mediaDevices.getUserMedia({ audio: true });
      },
      issueGrant: async () => {
        const response = await authedActionFetch("/api/pub-pal/voice-token", { method: "POST" });
        const body = await response.json() as VoiceTokenResponse;
        if (!response.ok || !body.signedUrl) {
          throw new PubPalVoiceStartError(
            errorMessageFrom(body, "Voice is unavailable. Use text instead."),
          );
        }
        grantIssuedRef.current = true;
        return { ...body, signedUrl: body.signedUrl };
      },
      connect: (grant) => {
        if (disposedRef.current) {
          void finalizeSession(false);
          return;
        }
        const maxSessionSeconds = grant.maxSessionSeconds ?? PAL_VOICE_MAX_SESSION_SECONDS;
        const overrides = grant.overrides;
        startSession({
          signedUrl: grant.signedUrl,
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
            if (disposedRef.current) return;
            startController.settle();
            setIsStarting(false);
            sdkSessionStartedRef.current = true;
            connectedAtRef.current = Date.now();
            capTimerRef.current = window.setTimeout(() => {
              void stop();
            }, maxSessionSeconds * 1000);
          },
          onDisconnect: () => {
            if (disposedRef.current) return;
            startController.settle();
            setIsStarting(false);
            sdkSessionStartedRef.current = false;
            void finalizeSession(connectedAtRef.current !== null);
          },
          onError: () => {
            if (disposedRef.current) return;
            startController.settle();
            setIsStarting(false);
            setError(PAL_VOICE_START_ERROR);
            onStateChange?.("error");
            void finalizeSession(connectedAtRef.current !== null);
          },
        });
        sdkSessionStartedRef.current = true;
      },
      onFailure: (message) => {
        if (grantIssuedRef.current) void finalizeSession(false);
        if (disposedRef.current) return;
        setIsStarting(false);
        setError(message);
        onStateChange?.("error");
      },
      onCancelled: () => {
        if (grantIssuedRef.current) void finalizeSession(false);
      },
    });
    if (!started && !startController.isStarting() && !disposedRef.current) {
      setIsStarting(false);
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
        {isStarting
          ? "Starting voice"
          : status === "connected"
            ? "Pal is listening"
            : "Voice ready when you are"}
      </div>
      <div className="palVoiceActions">
        {status === "connected" ? (
          <button type="button" onClick={() => { void stop(); }}>
            <MicOff size={18} /> End
          </button>
        ) : (
          <button
            type="button"
            disabled={isStarting}
            aria-busy={isStarting}
            onClick={() => { void start(); }}
          >
            <Mic size={18} /> {isStarting ? "Starting" : "Start voice chat"}
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

// Voice is switched on per deployment by the captain's ElevenLabs keys (see
// docs/PUB_PAL_SETUP.md). Until they are set, the Pal SAYS so in its own voice
// and points at the writing door - a Start button that answers 503 on the tap
// reads as a broken feature rather than one nobody has turned on. Availability
// is TRI-STATE: while the answer is still coming the control renders neither
// claim, because "voice is off" is a statement we must have checked.
export type PalVoiceAvailability = "asking" | "available" | "unavailable";

export const PAL_VOICE_UNAVAILABLE_LINE =
  "Voice is not switched on here yet. Ask me in writing and you get the same grounded answers.";

/**
 * Read the probe's answer.
 *
 * Anything short of an explicit `available: true` is treated as off. That is
 * the safe half here and only here: the two states differ by which door the
 * Pal offers, and offering the writing door when voice was in fact available
 * costs a tap, while offering a Start button that answers 503 reads as broken.
 */
export function palVoiceAvailabilityFrom(
  ok: boolean,
  body: unknown,
): PalVoiceAvailability {
  if (!ok) return "unavailable";
  const available =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { available?: unknown }).available
      : undefined;
  return available === true ? "available" : "unavailable";
}

/** The voice-off card: one honest line and the door that does work. */
export function PalVoiceOffline() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_UNAVAILABLE_LINE}
      </div>
      <div className="palVoiceActions">
        <Link className="palVoiceWriteLink" href="/pal/chat">
          <Send size={17} aria-hidden="true" /> Ask in writing
        </Link>
      </div>
    </div>
  );
}

function useVoiceAvailability(): PalVoiceAvailability {
  const [state, setState] = useState<PalVoiceAvailability>("asking");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/pub-pal/voice-token", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          discardBody(response);
          setState("unavailable");
          return;
        }
        const body: unknown = await response.json().catch(() => ({}));
        setState(palVoiceAvailabilityFrom(true, body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    return () => controller.abort();
  }, []);
  return state;
}

export default function PubPalVoice({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const availability = useVoiceAvailability();

  // Tri-state: while the probe is out the control claims neither, because
  // "voice is off" is a statement we must have checked.
  if (availability === "asking") {
    return (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          Checking whether voice is on
        </div>
      </div>
    );
  }

  if (availability === "unavailable") return <PalVoiceOffline />;

  return (
    <ConversationProvider>
      <VoiceControls onStateChange={onStateChange} />
    </ConversationProvider>
  );
}
