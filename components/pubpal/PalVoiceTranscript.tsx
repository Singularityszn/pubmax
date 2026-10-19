"use client";

import { useEffect, useRef } from "react";
import { Keyboard, MapPinned } from "lucide-react";

import { PAL_VOICE_MAP_DELAY_MS, type PalVoiceLine } from "@/lib/palVoiceTranscript";

// The written half of a voice chat: what the person said, what the Pal is
// hearing right now, and what the Pal answered. It is a log, newest at the
// foot, and it scrolls itself so the newest line is always in view.

const WORD_STAGGER_CAP = 28;

function RevealedWords({ text }: { text: string }) {
  // split() with a capture group alternates word, space, word, so a word's
  // place in the sentence is half its position.
  const words = text.split(/(\s+)/);
  return (
    <>
      {words.map((part, position) => {
        if (position % 2 === 1) return part;
        const delay = Math.min(position / 2, WORD_STAGGER_CAP);
        return (
          <span key={position} className="palVoiceWord" style={{ "--w": delay } as React.CSSProperties}>
            {part}
          </span>
        );
      })}
    </>
  );
}

export default function PalVoiceTranscript({
  lines,
  palName,
  hearing,
  tentative,
  thinking,
  live,
  mapPending,
  onStayHere,
}: {
  lines: readonly PalVoiceLine[];
  palName: string;
  /** The person is talking right now. */
  hearing: boolean;
  /** The partial words heard so far, when the provider sends them. */
  tentative: string;
  /** The person's line has landed and the Pal has not answered yet. */
  thinking: boolean;
  live: boolean;
  mapPending: boolean;
  onStayHere: () => void;
}) {
  const logRef = useRef<HTMLOListElement>(null);
  const showHearing = live && (hearing || Boolean(tentative));

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo?.({ top: log.scrollHeight, behavior: "smooth" });
  }, [lines, showHearing, tentative, thinking, mapPending]);

  if (!lines.length && !showHearing && !thinking && !mapPending) {
    return (
      <p className="palVoiceEmpty">
        {live
          ? `Talk to ${palName}. Your words and the answers show up here.`
          : "Start voice chat and the conversation shows up here, so you can read along."}
        <span>Try “Cheap pints near Soho” or “Show me the map”.</span>
      </p>
    );
  }

  return (
    <ol ref={logRef} className="palVoiceLog" role="log" aria-live="polite" aria-label="Voice chat transcript">
      {lines.map((line) => (
        <li key={line.id} className={`palVoiceLine palVoiceLine--${line.speaker}`}>
          <span className="palVoiceSpeaker">
            {line.speaker === "you" ? "You" : palName}
            {line.via === "typed" ? (
              <small><Keyboard size={11} aria-hidden="true" /> typed</small>
            ) : null}
          </span>
          <p>{line.speaker === "pal" ? <RevealedWords text={line.text} /> : line.text}</p>
        </li>
      ))}
      {showHearing ? (
        <li className="palVoiceLine palVoiceLine--you palVoiceLine--live" aria-live="off">
          <span className="palVoiceSpeaker">You · hearing you</span>
          <p>
            {tentative}
            <span className="palVoiceDots" aria-hidden="true"><i /><i /><i /></span>
          </p>
        </li>
      ) : null}
      {thinking && !showHearing ? (
        <li className="palVoiceLine palVoiceLine--pal palVoiceLine--live" aria-live="off">
          <span className="palVoiceSpeaker">{palName}</span>
          <p>
            <span className="srOnly">{palName} is thinking</span>
            <span className="palVoiceDots" aria-hidden="true"><i /><i /><i /></span>
          </p>
        </li>
      ) : null}
      {mapPending ? (
        <li
          className="palVoiceLine palVoiceMapCard"
          role="status"
          style={{ "--map-delay": `${PAL_VOICE_MAP_DELAY_MS}ms` } as React.CSSProperties}
        >
          <MapPinned size={18} aria-hidden="true" />
          <p>Opening the map</p>
          <button type="button" onClick={onStayHere}>Stay here</button>
        </li>
      ) : null}
    </ol>
  );
}
