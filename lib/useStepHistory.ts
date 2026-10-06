"use client";

import { useEffect, useRef } from "react";

const HISTORY_KEY = "pubmaxStep";

function recordedStep(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return undefined;
  return (state as Record<string, unknown>)[HISTORY_KEY];
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
 * `enabled` is true while the wizard is on screen. Once it is not, the entries
 * it pushed are stale, and a Back onto one would change nothing the reader can
 * see, so the hook keeps going back past them.
 */
export function useStepHistory<T extends string | number>(
  step: T,
  setStep: (step: T) => void,
  options: { steps: readonly T[]; first: T; enabled?: boolean },
): void {
  const { steps, first, enabled = true } = options;
  const setStepRef = useRef(setStep);
  const stepsRef = useRef(steps);
  const firstRef = useRef(first);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    setStepRef.current = setStep;
    stepsRef.current = steps;
    firstRef.current = first;
    enabledRef.current = enabled;
  });

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const recorded = recordedStep(event.state);
      if (!enabledRef.current) {
        if (recorded !== undefined) window.history.back();
        return;
      }
      const next = stepsRef.current.find((candidate) => candidate === recorded) ?? firstRef.current;
      setStepRef.current(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const recorded = recordedStep(window.history.state);
    const state = { ...(window.history.state as object | null), [HISTORY_KEY]: step };
    if (recorded === undefined) {
      // The entry the wizard opened on. Marking it is what lets a Back from a
      // finished wizard tell this entry from the page before it.
      window.history.replaceState(state, "");
      return;
    }
    if (recorded === step) return;
    window.history.pushState(state, "");
  }, [enabled, step]);
}
