"use client";

import { useCallback, useEffect, useState } from "react";

import { MAP_PIN_REVEAL_EVENT } from "@/lib/mapPinRevealEvent";

/**
 * Latches the canvas's painted-pin announcement, which is what lifts the held
 * loading frame. The latch is RESETTABLE on purpose: a city change and a canvas
 * re-init (retry, context loss) both tear the map down and paint again, so a
 * one-shot latch would leave the next load with no loading chrome at all.
 */
export function useMapPinsRevealed(): {
  pinsRevealed: boolean;
  resetPinReveal: () => void;
} {
  const [pinsRevealed, setPinsRevealed] = useState(false);

  useEffect(() => {
    const onReveal = () => setPinsRevealed(true);
    window.addEventListener(MAP_PIN_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(MAP_PIN_REVEAL_EVENT, onReveal);
  }, []);

  const resetPinReveal = useCallback(() => setPinsRevealed(false), []);

  return { pinsRevealed, resetPinReveal };
}
