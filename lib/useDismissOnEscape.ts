"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Escape leaves the panel that is open.
 *
 * A panel anchored to a visible trigger does not join the surface trail
 * (lib/surfaceStack.ts): the way back IS the trigger, still on screen beside it.
 * What such a panel still owes the reader is a keyboard way out, because
 * without one the only exit is a close glyph the reader has to find with a
 * pointer.
 *
 * The handler claims the key, so a panel over the map does not also close the
 * drawer beneath it. One Escape, one level.
 *
 * The level is the TOP one. A panel that `panelRef` finds inside an inert
 * subtree sits under a modal (lib/useFocusTrap.ts inerts everything outside
 * it), so it leaves the key to that modal. The desktop venue list stays open
 * under the venue drawer it opened, and its Escape used to close the list the
 * reader could not see while the drawer stayed up.
 */
export function useDismissOnEscape(
  open: boolean,
  onDismiss: () => void,
  panelRef?: RefObject<HTMLElement | null>,
): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panelRef?.current?.closest("[inert]")) return;
      event.preventDefault();
      event.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, panelRef]);
}
