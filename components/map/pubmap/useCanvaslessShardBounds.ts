"use client";

import { useEffect, useRef, type RefObject } from "react";

import { boundsForOpeningView } from "@/lib/mapOpeningBounds";
import { openingLoadViewportFor, type MapBounds } from "@/lib/slimShards";

type Viewport = { center: [number, number]; zoom: number };

// A canvas is the ONLY thing that ever reports map bounds, and three arrival
// lanes (a search arrival, a UK place arrival, national browse) deliberately
// wait for that report before reading a single shard, so the pubs land where
// the reader was actually taken. With no canvas that wait never ends.
// Measured with the map chunk blocked: `/map?sel=<id>` sat at zero venues for
// the whole life of the page, which took the fallback's pub rows, the venue
// list and the log intent with it, while a bare `/map` loaded 141. So when
// the shell has decided there is no canvas, it hands the loader the opening
// view ONCE per attempt, through the same door the canvas comes through.
export function useCanvaslessShardBounds(
  door: RefObject<((bounds: MapBounds) => void) | null>,
  {
    canvasUnavailable,
    canvasAttempt,
    viewport,
    cityView,
  }: {
    canvasUnavailable: boolean;
    canvasAttempt: number;
    viewport: Viewport;
    cityView: Viewport;
  },
): void {
  const handedAttemptRef = useRef<number | null>(null);
  useEffect(() => {
    if (!canvasUnavailable) return;
    if (handedAttemptRef.current === canvasAttempt) return;
    handedAttemptRef.current = canvasAttempt;
    const bounds = boundsForOpeningView(openingLoadViewportFor(viewport, cityView));
    queueMicrotask(() => door.current?.(bounds));
  }, [canvasAttempt, canvasUnavailable, cityView, door, viewport]);
}
