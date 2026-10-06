"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const HISTORY_KEY = "pubmaxStep";
// How many entries the wizard pushed below this one. Zero is the entry it
// opened on, which belongs to the page before the wizard as much as to it.
const DEPTH_KEY = "pubmaxStepDepth";

function recordedStep(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return undefined;
  return (state as Record<string, unknown>)[HISTORY_KEY];
}

function recordedDepth(state: unknown): number {
  if (typeof state !== "object" || state === null) return 0;
  const depth = (state as Record<string, unknown>)[DEPTH_KEY];
  return typeof depth === "number" && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

/**
 * The step the current history entry was left on, when it is one of `steps`.
 * A wizard reads this once on mount so a reload lands where the reader was.
 */
export function readHistoryStep<T extends string | number>(steps: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  const recorded = recordedStep(window.history.state);
  return steps.find((step) => step === recorded) ?? null;
}

/**
 * Make a step-by-step wizard honest about the browser's Back button.
 *
 * Wizard steps are component state, so Back used to leave the page and throw
 * the reader out of a five-step flow. Each new step now pushes a history entry
 * that records it, and Back and Forward put the recorded step back. The URL
 * never changes, so nothing else about the route moves.
 *
 * A move to an earlier step walks back through the entries instead of pushing
 * one, so an in-app Back never leaves a later step waiting behind the
 * browser's Back. On the entry the wizard opened on, the step changes in place.
 *
 * A Back or Forward onto a step the screen cannot show leaves the screen on
 * the step it can, and the entry is brought into line the same way.
 *
 * `enabled` is true while the wizard is on screen. Once it is not, the entries
 * it pushed are stale, and a Back onto one would change nothing the reader can
 * see, so the hook keeps going back past them.
 *
 * The returned `leave` walks back through every entry the wizard pushed, then
 * runs its callback, so a finished or skipped wizard is one Back from the page
 * before it.
 */
export function useStepHistory<T extends string | number>(
  step: T,
  setStep: (step: T) => void,
  options: { steps: readonly T[]; first: T; enabled?: boolean },
): { leave: (then: () => void) => void } {
  const { steps, first, enabled = true } = options;
  const setStepRef = useRef(setStep);
  const stepsRef = useRef(steps);
  const firstRef = useRef(first);
  const enabledRef = useRef(enabled);
  const backTargetRef = useRef<{ target: T } | null>(null);
  const leavingRef = useRef<(() => void) | null>(null);
  // Counts Back and Forward landings on the wizard's entries, so the entry is
  // checked against the screen even when the step shown did not change.
  const [landings, setLandings] = useState(0);
  useEffect(() => {
    setStepRef.current = setStep;
    stepsRef.current = steps;
    firstRef.current = first;
    enabledRef.current = enabled;
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const leaving = leavingRef.current;
      if (leaving) {
        leavingRef.current = null;
        leaving();
        return;
      }
      const recorded = recordedStep(event.state);
      if (!enabledRef.current) {
        if (recorded !== undefined) window.history.back();
        return;
      }
      const backTarget = backTargetRef.current;
      if (backTarget) {
        // The screen already shows the target. Walk on until an entry holds
        // it, or an earlier step, or is the one the wizard opened on.
        const order = stepsRef.current;
        if (order.indexOf(recorded as T) > order.indexOf(backTarget.target) && recordedDepth(event.state) > 0) {
          window.history.back();
          return;
        }
        backTargetRef.current = null;
        if (recorded !== backTarget.target) {
          window.history.replaceState({ ...(event.state as object | null), [HISTORY_KEY]: backTarget.target }, "");
        }
        return;
      }
      const next = stepsRef.current.find((candidate) => candidate === recorded) ?? firstRef.current;
      if (recorded !== undefined) setLandings((count) => count + 1);
      setStepRef.current(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const current = window.history.state as object | null;
    const recorded = recordedStep(current);
    const depth = recordedDepth(current);
    if (recorded === step) return;
    const order = stepsRef.current;
    const earlier = recorded !== undefined && order.indexOf(step) < order.indexOf(recorded as T);
    if (earlier && depth > 0) {
      backTargetRef.current = { target: step };
      window.history.back();
      return;
    }
    if (recorded === undefined || earlier) {
      // The entry the wizard opened on. Marking it is what lets a Back from a
      // finished wizard tell this entry from the page before it.
      window.history.replaceState({ ...current, [HISTORY_KEY]: step, [DEPTH_KEY]: depth }, "");
      return;
    }
    window.history.pushState({ ...current, [HISTORY_KEY]: step, [DEPTH_KEY]: depth + 1 }, "");
  }, [enabled, step, landings]);

  const leave = useCallback((then: () => void) => {
    const depth = recordedDepth(window.history.state);
    if (depth === 0) {
      then();
      return;
    }
    leavingRef.current = then;
    window.history.go(-depth);
  }, []);

  return { leave };
}
