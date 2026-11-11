"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Send } from "lucide-react";

import type { PalAnimationState, PubPalAppearance } from "@/lib/pubPal";
import type { PalVoiceSignal } from "@/lib/palVoiceSignal";
import type { PalGenome } from "@/lib/palGenome";
import { usePalVoiceAvailability } from "@/components/pubpal/usePalVoiceAvailability";

export { palVoiceAvailabilityFrom } from "@/components/pubpal/usePalVoiceAvailability";
import {
  readPalVoiceHost,
  registerPalVoicePanel,
  revokePalVoiceCall,
  subscribePalVoiceHost,
  type PalVoicePanelProps,
} from "@/lib/palVoiceHost";

const readEngaged = () => readPalVoiceHost().engaged;
const readReady = () => readPalVoiceHost().ready;
const never = () => false;

/**
 * Where the voice panel draws on /pal. The call itself lives in PalVoiceHost
 * in the root shell, which fetches the SDK when this slot appears and draws
 * into it, so the call outlives the move to /map.
 */
function PalVoicePanelSlot({ onStateChange, palName, signal, appearance, genome, onMemoryChange }: PalVoicePanelProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ready = useSyncExternalStore(subscribePalVoiceHost, readReady, never);
  useEffect(() => {
    if (!element) return;
    return registerPalVoicePanel(element, { onStateChange, palName, signal, appearance, genome, onMemoryChange });
  }, [element, onStateChange, palName, signal, appearance, genome, onMemoryChange]);
  return (
    <>
      {ready ? null : (
        <div className="palVoice">
          <div className="palVoiceStatus" role="status">
            Warming up voice
          </div>
          <div className="palVoiceActions">
            <Link className="palVoiceWriteLink" href="/pal/chat">
              <Send size={16} aria-hidden="true" /> Ask in writing
            </Link>
          </div>
        </div>
      )}
      <div className="palVoiceSlot" ref={setElement} />
    </>
  );
}

// Voice is switched on per deployment by the captain's ElevenLabs keys (see
// docs/PUB_PAL_SETUP.md). Until they are set, the Pal SAYS so in its own voice
// and points at the writing door - a Start button that answers 503 on the tap
// reads as a broken feature rather than one nobody has turned on. Availability
// is TRI-STATE: while the answer is still coming the control renders neither
// claim, because "voice is off" is a statement we must have checked.

export const PAL_VOICE_UNAVAILABLE_LINE =
  "Voice is unavailable just now. Ask me in writing and you'll get the same answers.";
const PAL_VOICE_MUTED_LINE =
  "Voice is muted. Ask me in writing or turn voice back on when you want it.";

/** The voice-off card: one honest line and the door that does work. */
export function PalVoiceOffline() {
  return (
    <div className="palVoice palVoice--offline">
      <div className="palVoiceStatus" role="status">
        {PAL_VOICE_UNAVAILABLE_LINE}
      </div>
      <div className="palVoiceActions">
        <Link className="palVoiceWriteLink" href="/pal/chat">
          <Send size={16} aria-hidden="true" /> Ask in writing
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
          <Send size={16} aria-hidden="true" /> Ask in writing
        </Link>
      </div>
    </div>
  );
}

function VoiceAvailabilityGate({ onStateChange, palName, signal, appearance, genome, onMemoryChange }: {
  onStateChange?: (state: PalAnimationState) => void;
  palName?: string;
  signal?: PalVoiceSignal;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
  onMemoryChange?: () => void;
}) {
  const availability = usePalVoiceAvailability();
  // A call that came back from /map is live, so it needs no fresh probe.
  const engaged = useSyncExternalStore(subscribePalVoiceHost, readEngaged, never);

  // Tri-state: while the probe is out the control claims neither, because
  // "voice is off" is a statement we must have checked.
  if (availability === "asking" && !engaged) {
    return (
      <div className="palVoice">
        <div className="palVoiceStatus" role="status">
          Checking whether voice is on
        </div>
        <div className="palVoiceActions">
          <Link className="palVoiceWriteLink" href="/pal/chat">
            <Send size={16} aria-hidden="true" /> Ask in writing
          </Link>
        </div>
      </div>
    );
  }

  if (availability === "unavailable" && !engaged) return <PalVoiceOffline />;

  return (
    <PalVoicePanelSlot
      onStateChange={onStateChange}
      palName={palName}
      signal={signal}
      appearance={appearance}
      genome={genome}
      onMemoryChange={onMemoryChange}
    />
  );
}

export default function PubPalVoice({
  muted = false,
  onStateChange,
  palName,
  signal,
  appearance,
  genome,
  onMemoryChange,
}: {
  muted?: boolean;
  onStateChange?: (state: PalAnimationState) => void;
  /** The name the transcript prints beside the Pal's lines. */
  palName?: string;
  /** Where the live levels go, so the portrait can react to the voice. */
  signal?: PalVoiceSignal;
  /** The Pal's look, for the small live head inside the panel on a phone. */
  appearance?: PubPalAppearance;
  /** The Pal's genome, so the panel's head is held and moves like the big one. */
  genome?: PalGenome;
  onMemoryChange?: () => void;
}) {
  useEffect(() => {
    if (muted) revokePalVoiceCall();
  }, [muted]);
  if (muted) return <PalVoiceMuted />;
  return (
    <VoiceAvailabilityGate
      onStateChange={onStateChange}
      palName={palName}
      signal={signal}
      appearance={appearance}
      genome={genome}
      onMemoryChange={onMemoryChange}
    />
  );
}
