"use client";

// The live voice session, and the ONLY module that imports the ElevenLabs SDK.
//
// Split out because of what the gate beside it already knows: voice is
// env-gated per deployment, so `VoiceAvailabilityGate` (PubPalVoice.tsx) asks
// /api/pub-pal/voice-token before anything voice-shaped may render, and on a
// deployment with voice off nothing here ever mounts. The SDK was a static
// import all the same, so every cold /pal parsed a whole conversation runtime
// before first paint, for a control the reader may never reach and the
// deployment may not even offer.
//
// The tri-state is unchanged and stays in PubPalVoice.tsx. This module is only
// ever reached through the `available` branch.

import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Send } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { VoiceEndReason } from "@/lib/analyticsEvents";
import { authedActionFetch } from "@/lib/authedFetch";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { PalAnimationState } from "@/lib/pubPal";
import type { PalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { PAL_VOICE_MAX_SESSION_SECONDS } from "@/lib/palVoiceMetering";
import {
  ELEVENLABS_LIBSAMPLERATE_PATH,
  ELEVENLABS_WORKLET_PATHS,
} from "@/lib/elevenlabsWorkletAssets";
import {
  createPubPalVoiceStartController,
  PAL_MICROPHONE_PERMISSION_ERROR,
  PAL_VOICE_START_ERROR,
  PubPalVoiceStartError,
} from "@/lib/pubPalVoiceSession";

type VoiceTokenResponse = {
  signedUrl?: string;
  conversationId?: string;
  overrides?: PalVoiceOverrides;
  maxSessionSeconds?: number;
  error?: string;
};

type VoiceGrant = Omit<VoiceTokenResponse, "signedUrl"> & { signedUrl: string };

type VoiceSessionAttempt = {
  cancelled: boolean;
  releaseRequired: boolean;
  released: boolean;
  conversationId: string | null;
  sdkSessionStarted: boolean;
  connectedAt: number | null;
  capTimer: number | null;
  voiceEndReported: boolean;
  voiceEndReason: VoiceEndReason | null;
};

/**
 * Where a typed message goes when no voice session is live: the written Pal
 * thread, with the question already asked through its `?ask=` deep link. The
 * ElevenLabs SDK only takes text inside a running conversation, so the box
 * beside the Start button must not depend on one.
 */
function palWrittenAskHref(value: string): Route {
  return `/pal/chat?${new URLSearchParams({ ask: value }).toString()}`;
}

async function syncVoiceToolTurn(input: {
  conversationId: string;
  threadTurn?: { role: "user"; content: string };
}): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/tool-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: input.conversationId,
        cityId: DEFAULT_CITY_ID,
        ...(input.threadTurn ? { threadTurn: input.threadTurn } : {}),
      }),
    }, { requiresIdentity: true });
    discardBody(response);
  } catch {
    // Best effort: fencing still runs on the tool query alone when sync fails.
  }
}

/**
 * Tells the server a session ended. It names the conversation and nothing
 * else: the allowance is settled from the provider's own record of the call,
 * never from a figure the browser measures.
 */
async function releaseVoiceSession(conversationId: string | null): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", ...(conversationId ? { conversationId } : {}) }),
    }, { requiresIdentity: true });
    discardBody(response);
  } catch {
    // Best effort: a failed release must not block ending the local session.
  }
}

function VoiceControls({ onStateChange }: { onStateChange?: (state: PalAnimationState) => void }) {
  const router = useRouter();
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [text, setText] = useState("");
  const disposedRef = useRef(false);
  const activeAttemptRef = useRef<VoiceSessionAttempt | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const [startController] = useState(createPubPalVoiceStartController);

  const ownsAttempt = useCallback((attempt: VoiceSessionAttempt): boolean => (
    activeAttemptRef.current === attempt &&
    !attempt.cancelled &&
    !disposedRef.current
  ), []);

  const clearCapTimer = useCallback((attempt: VoiceSessionAttempt): void => {
    if (attempt.capTimer !== null) {
      window.clearTimeout(attempt.capTimer);
      attempt.capTimer = null;
    }
  }, []);

  const finalizeSession = useCallback(async (attempt: VoiceSessionAttempt) => {
    if (attempt.connectedAt !== null && !attempt.voiceEndReported) {
      attempt.voiceEndReported = true;
      trackEvent("voice_ended", { reason: attempt.voiceEndReason ?? "disconnect" });
    }
    if (attempt.released) return;
    clearCapTimer(attempt);
    attempt.connectedAt = null;
    if (!attempt.releaseRequired) return;
    attempt.released = true;
    void releaseVoiceSession(attempt.conversationId);
  }, [clearCapTimer]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const attempt = activeAttemptRef.current;
      if (!attempt) {
        startController.cancel();
        return;
      }
      attempt.cancelled = true;
      attempt.voiceEndReason ??= "user";
      if (attempt.sdkSessionStarted) {
        attempt.sdkSessionStarted = false;
        endSession();
      }
      startController.cancel();
      void finalizeSession(attempt);
    };
  }, [endSession, finalizeSession, startController]);

  useEffect(() => {
    if (status !== "connected") onStateChange?.("idle");
    else if (isSpeaking) onStateChange?.("speaking");
    else if (isListening) onStateChange?.("listening");
  }, [isListening, isSpeaking, onStateChange, status]);

  const stop = useCallback(async (attempt: VoiceSessionAttempt, reason: VoiceEndReason = "user") => {
    attempt.voiceEndReason ??= reason;
    if (!ownsAttempt(attempt)) return;
    const wasCurrent = activeAttemptRef.current === attempt;
    attempt.cancelled = true;
    startController.settle();
    setIsStarting(false);
    if (attempt.sdkSessionStarted) {
      attempt.sdkSessionStarted = false;
      endSession();
    }
    await finalizeSession(attempt);
    if (wasCurrent && activeAttemptRef.current === attempt && !disposedRef.current) {
      onStateChange?.("idle");
    }
  }, [endSession, finalizeSession, onStateChange, ownsAttempt, startController]);

  const stopCurrentAttempt = useCallback((): void => {
    const attempt = activeAttemptRef.current;
    if (attempt) void stop(attempt);
  }, [stop]);

  const start = async () => {
    if (disposedRef.current) return;
    if (startController.isStarting()) return;
    const attempt: VoiceSessionAttempt = {
      cancelled: false,
      releaseRequired: false,
      released: false,
      conversationId: null,
      sdkSessionStarted: false,
      connectedAt: null,
      capTimer: null,
      voiceEndReported: false,
      voiceEndReason: null,
    };
    activeAttemptRef.current = attempt;
    setError(null);
    setIsStarting(true);
    onStateChange?.("noticing");
    const started = await startController.start<VoiceGrant>({
      requestMicrophone: async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new PubPalVoiceStartError("Can't reach your microphone. Type instead.");
        }
        return navigator.mediaDevices.getUserMedia({ audio: true });
      },
      issueGrant: async () => {
        const response = await authedActionFetch("/api/pub-pal/voice-token", { method: "POST" }, { requiresIdentity: true });
        if (response.ok) attempt.releaseRequired = true;
        const body = await response.json() as VoiceTokenResponse;
        if (response.ok && body.conversationId) attempt.conversationId = body.conversationId;
        if (!response.ok || !body.signedUrl) {
          throw new PubPalVoiceStartError(
            errorMessageFrom(body, "Voice isn't available. Type instead."),
          );
        }
        return { ...body, signedUrl: body.signedUrl };
      },
      connect: (grant) => {
        if (!ownsAttempt(attempt)) {
          void finalizeSession(attempt);
          return;
        }
        const maxSessionSeconds = grant.maxSessionSeconds ?? PAL_VOICE_MAX_SESSION_SECONDS;
        const overrides = grant.overrides;
        if (grant.conversationId) conversationIdRef.current = grant.conversationId;
        attempt.sdkSessionStarted = true;
        startSession({
          signedUrl: grant.signedUrl,
          connectionType: "websocket",
          workletPaths: ELEVENLABS_WORKLET_PATHS,
          libsampleratePath: ELEVENLABS_LIBSAMPLERATE_PATH,
          onMessage: ({ role, message }) => {
            const conversationId = conversationIdRef.current;
            const content = message.trim();
            if (!conversationId || !content || role !== "user") return;
            void syncVoiceToolTurn({
              conversationId,
              threadTurn: { role: "user", content },
            });
          },
          overrides: overrides
            ? {
                agent: {
                  firstMessage: overrides.firstMessage,
                },
                ...(overrides.voiceId
                  ? { tts: { voiceId: overrides.voiceId } }
                  : {}),
              }
            : undefined,
          onConnect: () => {
            const boundId = conversationIdRef.current;
            if (boundId) void syncVoiceToolTurn({ conversationId: boundId });
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            // The session is live. This is reported on CONNECT and not on the
            // tap, because a grant that was refused, a microphone that was
            // denied, and a socket that never opened are all sessions that
            // never started. `connectedAt` is null until here, so it is also
            // the latch: a reconnect on the same attempt reports once.
            if (attempt.connectedAt === null) trackEvent("voice_started");
            attempt.connectedAt = Date.now();
            clearCapTimer(attempt);
            attempt.capTimer = window.setTimeout(() => {
              void stop(attempt, "cap");
            }, maxSessionSeconds * 1000);
          },
          onDisconnect: () => {
            conversationIdRef.current = null;
            attempt.voiceEndReason ??= "disconnect";
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            attempt.cancelled = true;
            attempt.sdkSessionStarted = false;
            void finalizeSession(attempt);
          },
          onError: (message) => {
            attempt.voiceEndReason ??= "error";
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            attempt.cancelled = true;
            if (attempt.sdkSessionStarted) {
              attempt.sdkSessionStarted = false;
              endSession();
            }
            const detail = typeof message === "string" ? message.trim() : "";
            setError(detail || PAL_VOICE_START_ERROR);
            onStateChange?.("error");
            void finalizeSession(attempt);
          },
        });
      },
      onFailure: (message) => {
        void finalizeSession(attempt);
        if (!ownsAttempt(attempt)) return;
        attempt.cancelled = true;
        setIsStarting(false);
        setError(message);
        onStateChange?.(
          message === PAL_MICROPHONE_PERMISSION_ERROR ? "idle" : "error",
        );
      },
      onCancelled: () => {
        void finalizeSession(attempt);
      },
    });
    if (!started && !startController.isStarting() && !disposedRef.current) {
      setIsStarting(false);
    }
  };

  const voiceConnecting = isStarting || status === "connecting";

  const send = () => {
    const value = text.trim();
    if (!value || voiceConnecting) return;
    if (status !== "connected") {
      // No live conversation: sendUserMessage would throw and the Pal would
      // sit on "thinking" forever. Ask the written Pal instead.
      setText("");
      router.push(palWrittenAskHref(value));
      return;
    }
    onStateChange?.("thinking");
    sendUserMessage(value);
    const conversationId = conversationIdRef.current;
    if (conversationId) {
      void syncVoiceToolTurn({
        conversationId,
        threadTurn: { role: "user", content: value },
      });
    }
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
          <button type="button" onClick={stopCurrentAttempt}>
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
            maxLength={500}
            placeholder="Or type the night you want…"
          />
          <button
            type="button"
            onClick={send}
            disabled={voiceConnecting}
            aria-label="Send message"
          >
            <Send size={17} />
          </button>
        </label>
      </div>
      {voiceConnecting && <p className="palVoiceHint">Connecting voice…</p>}
      {error && <p className="palVoiceError" role="alert">{error}</p>}
      <p className="palVoicePrivacy">
        No audio or transcript becomes a memory. The Pal can suggest facts, and you approve each one.
      </p>
    </div>
  );
}

/** The provider plus its controls. Mounted only once the probe says yes. */
export default function PubPalVoiceSession({
  onStateChange,
}: {
  onStateChange?: (state: PalAnimationState) => void;
}) {
  return (
    <ConversationProvider>
      <VoiceControls onStateChange={onStateChange} />
    </ConversationProvider>
  );
}
