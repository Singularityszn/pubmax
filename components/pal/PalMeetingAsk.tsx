"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowUp } from "lucide-react";

import { VibeChipButton, VibeChips } from "@/components/vibe/VibeChips";
import { trackEvent } from "@/lib/analytics";
import { PLAN_FIELD_LABEL } from "@/lib/planCopy";
import { useClientReady } from "@/lib/useClientReady";
import { VIBE_CHIPS } from "@/lib/vibeChips";

import "./palMeetingAsk.css";

// The first four chips answer "what kind of night": a big one, live and loud,
// a quiet pint, a cheeky one. Four keep the chat box on a phone's first
// screen; the chat itself offers all seven.
const MEETING_CHIPS = VIBE_CHIPS.slice(0, 4);

/**
 * The answers to the meeting screen's question, where it is asked: the vibe
 * chips and a chat box under them. Both hand the words to /pal/chat, which
 * sends them, so a guest meets the chat's own sign-in door with the draft kept.
 */
export default function PalMeetingAsk({ question }: { question: string }) {
  const router = useRouter();
  const clientReady = useClientReady();
  const inputId = useId();
  const [query, setQuery] = useState("");
  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    router.push(`/pal/chat?ask=${encodeURIComponent(text)}` as Route);
  };
  return (
    <div className="palMeetingAsk">
      <p className="palMeetingQuestion" aria-live="polite">{question}</p>
      <VibeChips shellClassName="palMeetingChips" groupLabel="Pick a vibe">
        {MEETING_CHIPS.map((chip) => (
          <VibeChipButton
            key={chip.id}
            disabled={!clientReady}
            onClick={() => {
              trackEvent("tonight_vibe_select", { vibe: chip.id });
              setQuery(chip.ask);
              send(chip.ask);
            }}
          >
            {chip.label}
          </VibeChipButton>
        ))}
      </VibeChips>
      <form
        className="palMeetingComposer"
        action="/pal/chat"
        onSubmit={(event) => {
          event.preventDefault();
          send(query);
        }}
      >
        <label className="palMeetingSr" htmlFor={inputId}>
          {PLAN_FIELD_LABEL}
        </label>
        <input
          id={inputId}
          name="ask"
          className="palMeetingInput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Quiet-ish near Bank, not pricey"
          maxLength={500}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className="palMeetingSend pressable"
          data-primary-action=""
          disabled={clientReady && !query.trim()}
          aria-label="Ask"
        >
          <ArrowUp size={20} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
