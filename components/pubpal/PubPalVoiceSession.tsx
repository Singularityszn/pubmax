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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mic, MicOff, Send } from "lucide-react";

import PalVoiceMeter, { type PalVoiceMeterMode } from "@/components/pubpal/PalVoiceMeter";
import PalVoiceFace from "@/components/pubpal/PalVoiceFace";
import PalVoiceTranscript from "@/components/pubpal/PalVoiceTranscript";
import { playPalVoiceSound } from "@/components/pubpal/palVoiceSounds";

import { trackEvent } from "@/lib/analytics";
import type { VoiceEndReason } from "@/lib/analyticsEvents";
import { authedActionFetch } from "@/lib/authedFetch";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { PalAnimationState, PubPalAppearance } from "@/lib/pubPal";
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
  PAL_VOICE_START_TIMEOUT_ERROR,
  PAL_VOICE_START_TIMEOUT_MS,
  PubPalVoiceStartError,
} from "@/lib/pubPalVoiceSession";
import {
  appendPalVoiceLine,
  correctPalVoiceLine,
  palAsksForMap,
  palAsksForNextStop,
  palNextStop,
  palNightStopsFrom,
  palVoiceLine,
  PAL_VOICE_MAP_DELAY_MS,
  PAL_VOICE_MAP_HREF,
  tentativeUserTranscriptFrom,
  type PalVoiceLine,
} from "@/lib/palVoiceTranscript";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";
import { isPlanActiveNow, readActivePlan } from "@/lib/activePlan";
import { readPlanMemberProjection } from "@/components/plan/usePlanMemberRead";
import type { PalGenome } from "@/lib/palGenome";

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
  startupTimer: number | null;
  requestAbort: AbortController;
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

const silentVolume = (): number => 0;
const silentSpectrum = (): Uint8Array => new Uint8Array(0);

type VoiceTranscript = {
  lines: PalVoiceLine[];
  setLines: Dispatch<SetStateAction<PalVoiceLine[]>>;
};

function VoiceControls({ onStateChange, resetPendingSession, text, setText, error, setError, palName, transcript, signal, appearance, genome }: {
  onStateChange?: (state: PalAnimationState) => void;
  resetPendingSession: (error: string | null) => void;
  text: string;
  setText: (text: string) => void;
  error: string | null;
  setError: (error: string | null) => void;
  palName: string;
  transcript: VoiceTranscript;
  signal?: PalVoiceSignal;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
}) {
  const router = useRouter();
  const {
    startSession,
    endSession,
    sendUserMessage,
    getInputVolume = silentVolume,
    getOutputByteFrequencyData = silentSpectrum,
  } = useConversationControls();
  const { status } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const { lines, setLines } = transcript;
  const [hearing, setHearing] = useState(false);
  const [tentative, setTentative] = useState("");
  const [awaitingPal, setAwaitingPal] = useState(false);
  const [mapPending, setMapPending] = useState(false);
  const [mapLabel, setMapLabel] = useState("Opening the map");
  const mapTimerRef = useRef<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startupStopped, setStartupStopped] = useState(false);
  const [usingFallbackVoice, setUsingFallbackVoice] = useState(false);
  const disposedRef = useRef(false);
  const activeAttemptRef = useRef<VoiceSessionAttempt | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const [startController] = useState(createPubPalVoiceStartController);

  const liveRef = useRef(false);
  useEffect(() => {
    liveRef.current = status === "connected";
  }, [status]);

  const stayHere = useCallback((): void => {
    if (mapTimerRef.current !== null) window.clearTimeout(mapTimerRef.current);
    mapTimerRef.current = null;
    setMapPending(false);
  }, []);

  // The person asked for the map in their own words. Leaving /pal ends the
  // voice session through the unmount below, so the allowance is released.
  const openMap = useCallback((href: string = PAL_VOICE_MAP_HREF, label = "Opening the map"): void => {
    if (mapTimerRef.current !== null) window.clearTimeout(mapTimerRef.current);
    setMapLabel(label);
    setMapPending(true);
    // The cue belongs to a live voice chat; a typed ask with no session is silent.
    if (liveRef.current) playPalVoiceSound("map");
    mapTimerRef.current = window.setTimeout(() => {
      mapTimerRef.current = null;
      router.push(href as Route);
    }, PAL_VOICE_MAP_DELAY_MS);
  }, [router]);
  const openMapRef = useRef(openMap);
  useEffect(() => {
    openMapRef.current = openMap;
  }, [openMap]);

  // "Next stop" during a planned night that is on: the map opens on the stop
  // after the one the person reached (their own Night Mode cursor). With no
  // night on it is an ordinary question for the Pal, so it answers false.
  const nightIsOn = useCallback((): boolean => isPlanActiveNow(readActivePlan(), Date.now()), []);
  const openNextStop = useCallback(async (): Promise<void> => {
    const plan = readActivePlan();
    if (!plan) return;
    const next = palNextStop(palNightStopsFrom(await readPlanMemberProjection(plan.id)), plan.stopIndex);
    if (next) openMapRef.current(next.href, `Opening ${next.venueName}, your next stop`);
    else openMapRef.current();
  }, []);
  const nightIsOnRef = useRef(nightIsOn);
  const openNextStopRef = useRef(openNextStop);
  useEffect(() => {
    openNextStopRef.current = openNextStop;
  }, [openNextStop]);
  useEffect(() => () => {
    if (mapTimerRef.current !== null) window.clearTimeout(mapTimerRef.current);
  }, []);

  useEffect(() => {
    if (status === "connected" && !isSpeaking) return;
    queueMicrotask(() => {
      if (isSpeaking) setAwaitingPal(false);
      if (status !== "connected") {
        setHearing(false);
        setTentative("");
        setAwaitingPal(false);
      }
    });
  }, [isSpeaking, status]);

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

  const clearStartupTimer = useCallback((attempt: VoiceSessionAttempt): void => {
    if (attempt.startupTimer !== null) {
      window.clearTimeout(attempt.startupTimer);
      attempt.startupTimer = null;
    }
  }, []);

  const finalizeSession = useCallback(async (attempt: VoiceSessionAttempt) => {
    clearStartupTimer(attempt);
    attempt.requestAbort.abort();
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
  }, [clearCapTimer, clearStartupTimer]);

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
    const resetSdk = attempt.sdkSessionStarted && attempt.connectedAt === null;
    if (attempt.connectedAt !== null) playPalVoiceSound("end");
    attempt.cancelled = true;
    startController.cancel();
    setIsStarting(false);
    setStartupStopped(true);
    if (attempt.sdkSessionStarted) {
      attempt.sdkSessionStarted = false;
      endSession();
    }
    await finalizeSession(attempt);
    if (wasCurrent && activeAttemptRef.current === attempt && !disposedRef.current) {
      onStateChange?.("idle");
      if (resetSdk) {
        resetPendingSession(reason === "error" ? PAL_VOICE_START_TIMEOUT_ERROR : null);
      }
    }
  }, [endSession, finalizeSession, onStateChange, ownsAttempt, resetPendingSession, startController]);

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
      startupTimer: null,
      requestAbort: new AbortController(),
      voiceEndReported: false,
      voiceEndReason: null,
    };
    activeAttemptRef.current = attempt;
    setError(null);
    setUsingFallbackVoice(false);
    setStartupStopped(false);
    setIsStarting(true);
    onStateChange?.("noticing");
    attempt.startupTimer = window.setTimeout(() => {
      if (!ownsAttempt(attempt)) return;
      void stop(attempt, "error").then(() => {
        if (activeAttemptRef.current !== attempt || disposedRef.current) return;
        setError(PAL_VOICE_START_TIMEOUT_ERROR);
        onStateChange?.("error");
      });
    }, PAL_VOICE_START_TIMEOUT_MS);
    const started = await startController.start<VoiceGrant>({
      requestMicrophone: async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new PubPalVoiceStartError("Can't reach your microphone. Type instead.");
        }
        return navigator.mediaDevices.getUserMedia({ audio: true });
      },
      issueGrant: async () => {
        const response = await authedActionFetch("/api/pub-pal/voice-token", {
          method: "POST",
          signal: attempt.requestAbort.signal,
        }, { requiresIdentity: true });
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
        setUsingFallbackVoice(overrides?.voiceSource === "species" || overrides?.voiceSource === "agent-default");
        if (grant.conversationId) conversationIdRef.current = grant.conversationId;
        attempt.sdkSessionStarted = true;
        startSession({
          signedUrl: grant.signedUrl,
          connectionType: "websocket",
          workletPaths: ELEVENLABS_WORKLET_PATHS,
          libsampleratePath: ELEVENLABS_LIBSAMPLERATE_PATH,
          onMessage: ({ role, message }) => {
            if (!ownsAttempt(attempt)) return;
            const content = message.trim();
            if (!content) return;
            if (role !== "user") {
              setLines((current) => appendPalVoiceLine(current, palVoiceLine("pal", content)));
              setAwaitingPal(false);
              return;
            }
            setLines((current) => appendPalVoiceLine(current, palVoiceLine("you", content)));
            setTentative("");
            setAwaitingPal(true);
            if (palAsksForMap(content)) openMapRef.current();
            else if (palAsksForNextStop(content) && nightIsOnRef.current()) void openNextStopRef.current();
            const conversationId = conversationIdRef.current;
            if (!conversationId) return;
            void syncVoiceToolTurn({
              conversationId,
              threadTurn: { role: "user", content },
            });
          },
          onAgentResponseCorrection: ({ original_agent_response, corrected_agent_response }) => {
            if (!ownsAttempt(attempt)) return;
            setLines((current) =>
              correctPalVoiceLine(current, original_agent_response, corrected_agent_response),
            );
          },
          onDebug: (event: unknown) => {
            if (!ownsAttempt(attempt)) return;
            const heard = tentativeUserTranscriptFrom(event);
            if (heard !== null) setTentative(heard);
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
            if (!ownsAttempt(attempt)) return;
            const boundId = conversationIdRef.current;
            if (boundId) void syncVoiceToolTurn({ conversationId: boundId });
            clearStartupTimer(attempt);
            startController.settle();
            setIsStarting(false);
            // The session is live. This is reported on CONNECT and not on the
            // tap, because a grant that was refused, a microphone that was
            // denied, and a socket that never opened are all sessions that
            // never started. `connectedAt` is null until here, so it is also
            // the latch: a reconnect on the same attempt reports once.
            if (attempt.connectedAt === null) playPalVoiceSound("start");
            if (attempt.connectedAt === null) trackEvent("voice_started");
            attempt.connectedAt = Date.now();
            clearCapTimer(attempt);
            attempt.capTimer = window.setTimeout(() => {
              void stop(attempt, "cap");
            }, maxSessionSeconds * 1000);
          },
          onDisconnect: () => {
            attempt.voiceEndReason ??= "disconnect";
            if (!ownsAttempt(attempt)) return;
            if (attempt.connectedAt !== null) playPalVoiceSound("end");
            conversationIdRef.current = null;
            startController.settle();
            setIsStarting(false);
            setStartupStopped(true);
            attempt.cancelled = true;
            attempt.sdkSessionStarted = false;
            void finalizeSession(attempt);
          },
          onError: (message) => {
            attempt.voiceEndReason ??= "error";
            if (!ownsAttempt(attempt)) return;
            startController.settle();
            setIsStarting(false);
            setStartupStopped(true);
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
        setStartupStopped(true);
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

  const voiceConnecting = isStarting || (status === "connecting" && !startupStopped);

  const send = () => {
    const value = text.trim();
    if (!value || voiceConnecting) return;
    if (palAsksForMap(value)) {
      setLines((current) => appendPalVoiceLine(current, palVoiceLine("you", value, "typed")));
      setText("");
      openMap();
      return;
    }
    if (palAsksForNextStop(value) && nightIsOn()) {
      setLines((current) => appendPalVoiceLine(current, palVoiceLine("you", value, "typed")));
      setText("");
      void openNextStop();
      return;
    }
    if (status !== "connected") {
      // No live conversation: sendUserMessage would throw and the Pal would
      // sit on "thinking" forever. Ask the written Pal instead.
      setText("");
      router.push(palWrittenAskHref(value));
      return;
    }
    onStateChange?.("thinking");
    setLines((current) => appendPalVoiceLine(current, palVoiceLine("you", value, "typed")));
    setAwaitingPal(true);
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

  const live = status === "connected";
  const meterMode: PalVoiceMeterMode = voiceConnecting
    ? "connecting"
    : live
      ? isSpeaking ? "speaking" : "listening"
      : "idle";
  const faceState: PalAnimationState = voiceConnecting
    ? "noticing"
    : live
      ? isSpeaking ? "speaking" : awaitingPal ? "thinking" : "listening"
      : "idle";

  // The portrait beside the panel reads the same levels the meter does.
  useEffect(() => {
    if (!signal) return;
    signal.attach({ mode: meterMode, getInputVolume, getOutputByteFrequencyData });
    return () => signal.attach(null);
  }, [getInputVolume, getOutputByteFrequencyData, meterMode, signal]);

  return (
    <div className="palVoice" data-mode={meterMode}>
      <div className="palVoiceHead">
        {appearance ? <PalVoiceFace appearance={appearance} signal={signal} state={faceState} genome={genome} /> : null}
        <div className="palVoiceStatus" role="status">
          <i className={live ? "isLive" : ""} />
          {isStarting
            ? "Starting voice"
            : live
              ? isSpeaking ? "Pal is talking" : "Pal is listening"
              : "Voice ready when you are"}
        </div>
        <PalVoiceMeter
          mode={meterMode}
          getInputVolume={getInputVolume}
          getOutputByteFrequencyData={getOutputByteFrequencyData}
          onVoiceActivity={setHearing}
        />
      </div>
      <PalVoiceTranscript
        lines={lines}
        palName={palName}
        hearing={hearing && !isSpeaking}
        tentative={isSpeaking ? "" : tentative}
        thinking={awaitingPal && live && !isSpeaking}
        live={live}
        mapPending={mapPending}
        mapLabel={mapLabel}
        onStayHere={stayHere}
      />
      <div className="palVoiceActions">
        {status === "connected" ? (
          <button type="button" onClick={stopCurrentAttempt}>
            <MicOff size={16} /> End
          </button>
        ) : (
          <button
            type="button"
            disabled={isStarting}
            aria-busy={isStarting}
            onClick={() => { void start(); }}
          >
            <Mic size={16} /> {isStarting ? "Starting" : "Start voice chat"}
          </button>
        )}
        {voiceConnecting && (
          <button type="button" aria-label="Cancel voice startup" onClick={stopCurrentAttempt}>
            Cancel
          </button>
        )}
        {(voiceConnecting || error) && (
          <Link className="palVoiceWriteLink" href={text.trim() ? palWrittenAskHref(text.trim()) : "/pal/chat"} prefetch={false} onNavigate={stopCurrentAttempt}>
            <Send size={16} aria-hidden="true" /> Ask in writing
          </Link>
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
            <Send size={16} />
          </button>
        </label>
      </div>
      {voiceConnecting && <p className="palVoiceHint">Connecting voice…</p>}
      {usingFallbackVoice && (voiceConnecting || status === "connected") && (
        <p className="palVoiceHint" role="status">Your chosen voice isn&apos;t available. Using your Pal&apos;s default voice.</p>
      )}
      {error && <p className="palVoiceError" role="alert">{error}</p>}
      <p className="palVoicePrivacy">
        No audio or transcript becomes a memory. The Pal can suggest facts, and you approve each one.
      </p>
    </div>
  );
}

/** The writing draft outlives a provider whose pending startup was cancelled. */
export default function PubPalVoiceSession({
  onStateChange,
  palName = "Pal",
  signal,
  appearance,
  genome,
}: {
  onStateChange?: (state: PalAnimationState) => void;
  palName?: string;
  signal?: PalVoiceSignal;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
}) {
  const [sdkGeneration, setSdkGeneration] = useState(0);
  // The transcript outlives an SDK reset and a session that ended, so the
  // person can read back what was said. It lives in this tab only.
  const [lines, setLines] = useState<PalVoiceLine[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resetPendingSession = useCallback((nextError: string | null) => {
    setError(nextError);
    setSdkGeneration((generation) => generation + 1);
    if (nextError) onStateChange?.("error");
  }, [onStateChange]);
  return (
    <ConversationProvider key={sdkGeneration}>
      <VoiceControls
        onStateChange={onStateChange}
        resetPendingSession={resetPendingSession}
        text={text}
        setText={setText}
        error={error}
        setError={setError}
        palName={palName}
        transcript={{ lines, setLines }}
        signal={signal}
        appearance={appearance}
        genome={genome}
      />
    </ConversationProvider>
  );
}
