"use client";

import { useEffect, useState } from "react";

import {
  isNightModeDismissed,
  isPlanActiveNow,
  readActivePlan,
  subscribeActivePlan,
  subscribeNightModeDismiss,
  type ActivePlanRef,
} from "@/lib/activePlan";

// How often we re-check the time window, so a plan that ages out of its active
// span (start + POST) retires the card without a navigation. 60s is plenty —
// the window edges are hours wide, not seconds.
const WINDOW_TICK_MS = 60_000;

export type NightModeState = {
  /** The live plan pointer, or null when nothing is on tonight. */
  ref: ActivePlanRef | null;
  /** True when there's an active plan the user has not dismissed this session. */
  visible: boolean;
  /** True when there's an active plan that IS dismissed (show the re-open pill). */
  dismissed: boolean;
};

const IDLE: NightModeState = { ref: null, visible: false, dismissed: false };

function resolve(now: number): NightModeState {
  const ref = readActivePlan();
  if (!isPlanActiveNow(ref, now) || !ref) return IDLE;
  const dismissed = isNightModeDismissed(ref.id);
  return { ref, visible: !dismissed, dismissed };
}

/**
 * Active-plan detection for the Night Mode shell card. Reads the localStorage
 * pointer (lib/activePlan), subscribes to same-tab/cross-tab changes and to the
 * dismiss toggle, and re-evaluates the active-time window on an interval. Pure
 * SSR-safe: returns the idle state on the server and first paint, then upgrades
 * after mount (no hydration mismatch, since the pointer is client-only state).
 */
export function useActivePlan(): NightModeState {
  const [state, setState] = useState<NightModeState>(IDLE);

  useEffect(() => {
    const recompute = () => setState(resolve(Date.now()));
    recompute();
    const unsubPlan = subscribeActivePlan(recompute);
    const unsubDismiss = subscribeNightModeDismiss(recompute);
    const timer = window.setInterval(recompute, WINDOW_TICK_MS);
    return () => {
      unsubPlan();
      unsubDismiss();
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
