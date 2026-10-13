"use client";

import { useEffect, useRef, type RefObject } from "react";

function isInInertSubtree(node: HTMLElement): boolean {
  let cursor: HTMLElement | null = node;
  while (cursor) {
    if (cursor.inert || cursor.hasAttribute("inert")) return true;
    cursor = cursor.parentElement;
  }
  return false;
}

type EscapePanel = {
  dismiss: () => void;
  ref?: RefObject<HTMLElement | null>;
};

const openPanels = new Set<EscapePanel>();

function dismissTopPanel(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  let top: EscapePanel | undefined;
  for (const panel of openPanels) {
    const node = panel.ref?.current;
    if (node && isInInertSubtree(node)) continue;
    // The newest open sibling wins. A containing parent cannot replace its
    // child, even when React mounts the child's effect before the parent's.
    if (!top || !node?.contains(top.ref?.current ?? null)) top = panel;
  }
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.dismiss();
}

function dismissNativePanel(event: KeyboardEvent): void {
  // Native Back dispatches directly on window. Ordinary keyboard input must
  // first reach React controls and the document's panel dispatcher.
  if (event.target === event.currentTarget) dismissTopPanel(event);
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
    const panel: EscapePanel = { dismiss: () => onDismissRef.current(), ref: panelRef };
    if (openPanels.size === 0) {
      document.addEventListener("keydown", dismissTopPanel);
      window.addEventListener("keydown", dismissNativePanel, true);
    }
    openPanels.add(panel);
    return () => {
      openPanels.delete(panel);
      if (openPanels.size === 0) {
        document.removeEventListener("keydown", dismissTopPanel);
        window.removeEventListener("keydown", dismissNativePanel, true);
      }
    };
  }, [open, panelRef]);
}
