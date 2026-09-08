"use client";

import { useEffect, useRef } from "react";

const dismissals: Array<() => void> = [];

/** Map navigation yields even when its listener runs before the shared one. */
export function hasEscapeDismissal(): boolean {
  return dismissals.length > 0;
}

function dismissTopPanel(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const dismiss = dismissals.at(-1);
  if (!dismiss) return;
  // Native Back reads cancellation immediately after dispatching this event.
  event.preventDefault();
  event.stopPropagation();
  dismiss();
}

/**
 * Escape leaves the panel that is open.
 *
 * A panel anchored to a visible trigger does not join the surface trail
 * (lib/surfaceStack.ts): the way back IS the trigger, still on screen beside it.
 * What such a panel still owes the reader is a keyboard way out, because
 * without one the only exit is a close glyph the reader has to find with a
 * pointer.
 *
 * One shared listener dismisses the most recently opened panel. Callback
 * updates keep its position. Focused controls may consume the key first.
 */
export function useDismissOnEscape(open: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => onDismissRef.current();
    dismissals.push(dismiss);
    if (dismissals.length === 1) window.addEventListener("keydown", dismissTopPanel);
    return () => {
      dismissals.splice(dismissals.indexOf(dismiss), 1);
      if (!dismissals.length) window.removeEventListener("keydown", dismissTopPanel);
    };
  }, [open]);
}
