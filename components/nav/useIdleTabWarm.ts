"use client";

import { useEffect } from "react";

import {
  IDLE_TAB_WARM_DELAY_MS,
  transitionIdleTabWarm,
  type IdleTabWarmEvent,
  type IdleTabWarmState,
} from "@/lib/idleTabWarm";
import { shouldWarmMapIntent } from "@/lib/mapWarmup";

/**
 * Runs the idle tab warm (lib/idleTabWarm.ts) for one page: this hook owns the
 * load listener, the timer and the idle callback, and calls `warm` when the
 * machine says so. `warm` must be stable between renders.
 */
export function useIdleTabWarm(enabled: boolean, warm: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const allowed = () => shouldWarmMapIntent(window.navigator);
    let state: IdleTabWarmState = { phase: "off" };
    let stop: () => void = () => {};

    // No effect below calls back in the same turn, so `stop` always belongs to
    // the stage the machine is in.
    const effectFor = (next: IdleTabWarmState): (() => void) => {
      switch (next.phase) {
        case "awaiting_load": {
          const onLoad = () => send({ type: "loaded" });
          window.addEventListener("load", onLoad, { once: true });
          return () => window.removeEventListener("load", onLoad);
        }
        case "awaiting_delay": {
          const timer = window.setTimeout(() => send({ type: "delay_elapsed" }), IDLE_TAB_WARM_DELAY_MS);
          return () => window.clearTimeout(timer);
        }
        case "awaiting_idle": {
          const onIdle = () =>
            send({ type: "idle", allowed: allowed(), visible: document.visibilityState === "visible" });
          if (typeof window.requestIdleCallback === "function") {
            const handle = window.requestIdleCallback(onIdle);
            return () => window.cancelIdleCallback(handle);
          }
          const timer = window.setTimeout(onIdle, 0);
          return () => window.clearTimeout(timer);
        }
        case "warmed":
          warm();
          return () => {};
        case "off":
          return () => {};
      }
    };

    function send(event: IdleTabWarmEvent) {
      const next = transitionIdleTabWarm(state, event);
      if (next === state) return;
      stop();
      state = next;
      stop = effectFor(next);
    }

    send({ type: "start", allowed: allowed(), loaded: document.readyState === "complete" });
    return () => send({ type: "cancel" });
  }, [enabled, warm]);
}
