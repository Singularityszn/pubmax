"use client";

import { useEffect, useState } from "react";

import {
  MAP_SECONDARY_STREAM_HOLD_CEILING_MS,
  mapSecondaryStreamsHeld,
} from "@/lib/mapFirstPinStreams";

/**
 * Owns the hold's clock so `lib/mapFirstPinStreams.ts` can stay a pure rule.
 *
 * The ceiling is armed ONCE, at mount, and a lapse is never taken back: a
 * canvas re-init resets the reveal latch (`useMapPinsRevealed`), and re-holding
 * the sides on a retry would starve a reader who has already waited out the
 * whole ceiling once.
 */
export function useMapSecondaryStreamHold({
  pinsRevealed,
  canvasUnavailable,
}: {
  pinsRevealed: boolean;
  canvasUnavailable: boolean;
}): boolean {
  const [holdCeilingLapsed, setHoldCeilingLapsed] = useState(false);

  useEffect(() => {
    if (holdCeilingLapsed) return;
    const handle = window.setTimeout(
      () => setHoldCeilingLapsed(true),
      MAP_SECONDARY_STREAM_HOLD_CEILING_MS,
    );
    return () => window.clearTimeout(handle);
  }, [holdCeilingLapsed]);

  return mapSecondaryStreamsHeld({
    pinsRevealed,
    canvasUnavailable,
    holdCeilingLapsed,
  });
}
