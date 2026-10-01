"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Send } from "lucide-react";

import { discardBody } from "@/lib/responseBody";
import type { PalAnimationState } from "@/lib/pubPal";

// The session half carries the ElevenLabs SDK, so it is fetched when the probe
// says voice is on and never before. ssr:false because there is nothing to
// render on the server for a control that needs a microphone.
const PubPalVoiceSession = dynamic(
  () => import("@/components/pubpal/PubPalVoiceSession"),
  {
    ssr: false,
    loading: () => (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          Warming up voice
        </div>
      </div>
    ),
  },
);

// Typed Pal chat shares voice's provider. Map Ask works without that provider.
export type PalVoiceAvailability = "asking" | "available" | "unavailable";

export const PAL_VOICE_UNAVAILABLE_LINE =
  "Voice is unavailable here. Use Ask on the map to find pubs and plan a night.";
const PAL_VOICE_MUTED_LINE =
  "Voice is muted. Ask me in writing or turn voice back on when you want it.";

/** Only an affirmative probe can offer provider-backed chat or voice. */
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

/** A provider-free way onward when voice is unavailable. */
export function PalVoiceOffline() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_UNAVAILABLE_LINE}
      </div>
      <div className="palVoiceActions">
        <Link className="palVoiceWriteLink" href="/map">
          <Send size={17} aria-hidden="true" /> Ask on the map
        </Link>
      </div>
    </div>
  );
}

function PalVoiceMuted() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_MUTED_LINE}
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
        if (controller.signal.aborted) {
          discardBody(response);
          return;
        }
        if (!response.ok) {
          discardBody(response);
          setState("unavailable");
          return;
        }
        const body: unknown = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setState(palVoiceAvailabilityFrom(true, body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    return () => controller.abort();
  }, []);
  return state;
}

function VoiceAvailabilityGate({ muted, onStateChange }: {
  muted: boolean;
  onStateChange?: (state: PalAnimationState) => void;
}) {
  const availability = useVoiceAvailability();

  // Tri-state: while the probe is out the control claims neither, because
  // "voice is off" is a statement we must have checked.
  if (availability === "asking") {
    return (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          {muted ? "Checking whether writing is available" : "Checking whether voice is on"}
        </div>
      </div>
    );
  }

  if (availability === "unavailable") return <PalVoiceOffline />;
  if (muted) return <PalVoiceMuted />;

  return <PubPalVoiceSession onStateChange={onStateChange} />;
}

export default function PubPalVoice({
  muted = false,
  onStateChange,
}: {
  muted?: boolean;
  onStateChange?: (state: PalAnimationState) => void;
}) {
  return <VoiceAvailabilityGate muted={muted} onStateChange={onStateChange} />;
}
