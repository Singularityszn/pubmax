"use client";

// A venue sheet used to ask for every one of its panels in the same frame: about
// twenty parallel GETs in one second from one IP. Vercel's edge firewall counts
// requests per IP per second, and it answered a burst of that size with a deny
// (`x-vercel-mitigated: deny`) that took unrelated routes down with it for
// several seconds. The panels below the first screen do not need to be on the
// wire before the first screen has painted, so each one starts in a later phase.
//
// A phase is a delay, not a priority queue: phase 0 starts at once, and a read
// in a later phase starts that many milliseconds after the sheet it belongs to
// opened. Opening another venue starts the clock again. The delays are short
// enough that a panel still lands inside the time a person takes to scroll to
// it.

import { useEffect, useState } from "react";

/** When each phase starts, in milliseconds after the sheet opened. */
export const READ_PHASE_DELAY_MS = [0, 400, 900, 1_500] as const;

export type ReadPhase = 0 | 1 | 2 | 3;

/**
 * Has this sheet been open long enough for a read in `phase` to start?
 * `scope` is whatever the read is about (a venue id): a new scope restarts the
 * wait, so a quick tap from one pub to the next never reads the first pub's
 * lower panels on the second pub's clock.
 */
export function useStaggeredRead(phase: ReadPhase, scope: string): boolean {
  const [readyFor, setReadyFor] = useState<string | null>(null);
  useEffect(() => {
    if (phase === 0) return;
    const timer = setTimeout(
      () => setReadyFor(scope),
      READ_PHASE_DELAY_MS[phase],
    );
    return () => clearTimeout(timer);
  }, [phase, scope]);
  return phase === 0 || readyFor === scope;
}
