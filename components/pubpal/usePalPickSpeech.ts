"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { PalCard } from "@/lib/palChat";
import { applyPalMapCommand, readPalMapState, subscribePalMapState } from "@/lib/palMapCommands";
import { createPalPickSpeech, type PalPlaybackAlignment } from "@/lib/palPickSpeech";

/**
 * Focus the map pick the Pal is naming as its audio plays. `stop` drops the
 * focus and any cue still waiting, for an interruption or a new turn.
 */
export function usePalPickSpeech(): { play: (event: PalPlaybackAlignment) => void; stop: () => void } {
  const [speech] = useState(createPalPickSpeech);
  const timers = useRef(new Set<number>());
  const cancel = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    speech.reset();
  }, [speech]);
  const stop = useCallback(() => {
    cancel();
    applyPalMapCommand({ kind: "focusPick", number: null });
  }, [cancel]);
  const play = useCallback((event: PalPlaybackAlignment) => {
    for (const cue of speech.play(event, readPalMapState().picks)) {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        applyPalMapCommand({ kind: "focusPick", number: cue.number });
      }, cue.delayMs);
      timers.current.add(timer);
    }
  }, [speech]);
  // A cue is for the picks it was read against. New picks retire it.
  useEffect(() => {
    let sequence = readPalMapState().sequence;
    const unsubscribe = subscribePalMapState(() => {
      if (readPalMapState().sequence === sequence) return;
      sequence = readPalMapState().sequence;
      cancel();
    });
    return () => {
      unsubscribe();
      cancel();
    };
  }, [cancel]);
  return { play, stop };
}

/** The answer card for the pick the Pal is naming, if one is focused. */
export function usePalFocusedCard(cards: readonly PalCard[]): { number: number; card: PalCard } | null {
  const { picks, focused } = useSyncExternalStore(subscribePalMapState, readPalMapState, readPalMapState);
  const pick = picks.find((item) => item.number === focused);
  const card = pick && cards.find((item) => item.venueId === pick.venueId);
  return pick && card ? { number: pick.number, card } : null;
}
