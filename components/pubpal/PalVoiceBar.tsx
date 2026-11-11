"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { Mic, MicOff, X } from "lucide-react";

import PalCardPrice from "@/components/pal/PalCardPrice";
import PalVoiceCountdown from "@/components/pubpal/PalVoiceCountdown";
import { PubPalAvatar } from "@/components/pubpal/PubPalAvatar";
import type { PalCard } from "@/lib/palChat";
import type { PubPalAppearance } from "@/lib/pubPal";
import type { PalGenome } from "@/lib/palGenome";
import type { PalVoiceLine } from "@/lib/palVoiceTranscript";
import { palVoiceEndedHint, palVoiceEndedStatus, type PalVoiceEnded } from "@/lib/palVoiceCall";
import { setPalVoiceEngaged } from "@/lib/palVoiceHost";
import "./palVoiceBar.css";

/** While any of these holds, the shell keeps the call mounted off /pal. */
export function usePalVoiceEngaged(holds: boolean[]): void {
  const engaged = holds.some(Boolean);
  useEffect(() => {
    setPalVoiceEngaged(engaged);
  }, [engaged]);
  useEffect(() => () => setPalVoiceEngaged(false), []);
}

/** True while the call is on the map, where "show me the map" opens nothing more. */
export function useOnMapRef(): RefObject<boolean> {
  const pathname = usePathname() ?? "";
  const onMap = useRef(false);
  useEffect(() => {
    onMap.current = pathname === "/map" || pathname.startsWith("/map/");
  }, [pathname]);
  return onMap;
}

/**
 * The voice call off /pal: the Pal's face, what is happening, the newest line
 * and the one control that ends or resumes the call. The full transcript stays
 * with the call and shows again on /pal.
 */
export default function PalVoiceBar({
  palName,
  appearance,
  genome,
  lines,
  pick = null,
  error,
  live,
  speaking,
  starting,
  ended,
  callEndsAt = null,
  onEnd,
  onCarryOn,
  onClose,
}: {
  palName: string;
  appearance?: PubPalAppearance;
  genome?: PalGenome;
  lines: PalVoiceLine[];
  /** The map pick the Pal is naming, with its price and where the price came from. */
  pick?: { number: number; card: PalCard } | null;
  error: string | null;
  live: boolean;
  speaking: boolean;
  starting: boolean;
  ended: PalVoiceEnded | null;
  /** When a live call hits its cap, once its last stretch has begun. */
  callEndsAt?: number | null;
  onEnd: () => void;
  onCarryOn: () => void;
  onClose: () => void;
}) {
  const barRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const publish = () => {
      document.body.style.setProperty("--pal-voice-bar-h", `${bar.getBoundingClientRect().height}px`);
    };
    publish();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      document.body.style.removeProperty("--pal-voice-bar-h");
    };
  }, []);
  const status = starting
    ? "Starting voice"
    : live
      ? `${palName} is ${speaking ? "talking" : "listening"}`
      : ended ? palVoiceEndedStatus(ended.why, palName) : "Voice stopped";
  const line = lines.at(-1);
  const caption = error ?? (line ? (line.speaker === "pal" ? line.text : `You: ${line.text}`) : null);
  const allowance = palVoiceEndedHint(ended, !live && !starting);
  return (
    <section ref={barRef} className="palVoiceBar" aria-label={`Voice chat with ${palName}`} data-focus-trap-exempt="" data-live={live ? "true" : undefined}>
      {pick ? (
        <div className="palVoiceBarPick">
          <span className="palVoiceBarPickNumber" aria-hidden="true">{pick.number}</span>
          <p className="palVoiceBarPickTitle">{pick.card.title}</p>
          <PalCardPrice card={pick.card} className="palVoiceBarPickPrice" />
          {pick.card.provenance.url
            ? <a className="palVoiceBarPickSource" href={pick.card.provenance.url} target="_blank" rel="noreferrer noopener">{pick.card.provenance.label}</a>
            : <p className="palVoiceBarPickSource">{pick.card.provenance.label}</p>}
        </div>
      ) : null}
      {appearance ? <PubPalAvatar appearance={appearance} name={palName} compact genome={genome} /> : null}
      <div className="palVoiceBarText">
        <p role="status">{status}<PalVoiceCountdown live={live} endsAt={callEndsAt} /></p>
        {caption ? <p className="palVoiceBarCaption" role={error ? "alert" : undefined}>{caption}</p> : null}
        {allowance ? <p className="palVoiceBarAllowance">{allowance}</p> : null}
      </div>
      {live || starting ? (
        <button type="button" onClick={onEnd} aria-label={live ? undefined : "Cancel voice startup"}>
          <MicOff size={16} aria-hidden="true" /> {live ? "End" : "Cancel"}
        </button>
      ) : (
        <>
          {ended ? (
            <button type="button" onClick={onCarryOn}>
              <Mic size={16} aria-hidden="true" /> Carry on
            </button>
          ) : null}
          <button type="button" className="palVoiceBarClose" onClick={onClose} aria-label="Close voice chat">
            <X size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  );
}
