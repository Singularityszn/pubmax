// The one shared state of Sun Chaser: on or off, the chosen time, and the last
// estimates the map layer worked out. The filter chip and the time scrubber
// write it, the lazy map layer fills it, and the pub sheet reads it. A plain
// external store so none of those three has to thread props through PubMap.

import { useSyncExternalStore } from "react";
import type { SunEstimate } from "@/lib/sunChaser";

/** Why the layer has no estimates to show right now. */
export type SunChaserStatus = "idle" | "zoom-in" | "no-buildings" | "ready";

export type SunChaserState = {
  enabled: boolean;
  /** Steps of SUN_CHASER_STEP_MINUTES after `from`; 0 is now. */
  offsetSteps: number;
  status: SunChaserStatus;
  /** The instant the estimates start from, rounded to the minute. */
  from: Date | null;
  /** Estimates for the recorded-garden pubs in view, by venue id. */
  estimates: ReadonlyMap<string, SunEstimate>;
  /** The weather feed's fresh condition word near the map centre, or null. */
  skyCondition: string | null;
};

const INITIAL: SunChaserState = {
  enabled: false,
  offsetSteps: 0,
  status: "idle",
  from: null,
  estimates: new Map(),
  skyCondition: null,
};

let state: SunChaserState = INITIAL;
const listeners = new Set<() => void>();

export function getSunChaserState(): SunChaserState {
  return state;
}

export function updateSunChaser(patch: Partial<SunChaserState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** Turning it off forgets every estimate, so a closed feature leaves nothing behind. */
export function setSunChaserEnabled(enabled: boolean): void {
  updateSunChaser(enabled ? { enabled } : { ...INITIAL });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSunChaser(): SunChaserState {
  return useSyncExternalStore(subscribe, getSunChaserState, () => INITIAL);
}
