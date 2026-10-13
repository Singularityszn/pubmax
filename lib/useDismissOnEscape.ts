"use client";

import { useEffect, useRef, type RefObject } from "react";

function isUnavailablePanel(node: HTMLElement): boolean {
  if (!node.isConnected) return true;
  const view = node.ownerDocument.defaultView;
  const visibility = view?.getComputedStyle(node).visibility;
  if (visibility === "hidden" || visibility === "collapse") return true;
  let cursor: HTMLElement | null = node;
  while (cursor) {
    if (cursor.inert || cursor.hasAttribute("inert") || cursor.hidden || view?.getComputedStyle(cursor).display === "none") return true;
    cursor = cursor.parentElement;
  }
  return false;
}

type EscapePanel = {
  dismiss: () => void;
  capture: boolean;
  ref?: RefObject<HTMLElement | null>;
};

const openPanels = new Set<EscapePanel>();

function dismissTopPanel(event: KeyboardEvent, captureOnly = false): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  let top: EscapePanel | undefined;
  for (const panel of openPanels) {
    const node = panel.ref?.current;
    if (captureOnly && !panel.capture) continue;
    if (node && isUnavailablePanel(node)) continue;
    // The newest open sibling wins. A containing parent cannot replace its
    // child, even when React mounts the child's effect before the parent's.
    if (!top || !node?.contains(top.ref?.current ?? null)) top = panel;
  }
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.dismiss();
}

function dismissCapturePanel(event: KeyboardEvent): void {
  dismissTopPanel(event, true);
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
 * A panel hidden by CSS or inside an inert subtree leaves the key to the
 * visible surface. Availability is read on dispatch because another surface
 * can hide a panel without unmounting it. Capture ownership spans both lazy
 * loading and mounting, before initial focus reaches the panel.
 */
export function useDismissOnEscape(
  open: boolean,
  onDismiss: () => void,
  panelRef?: RefObject<HTMLElement | null>,
  capture = false,
): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const panel: EscapePanel = { dismiss: () => onDismissRef.current(), ref: panelRef, capture };
    if (openPanels.size === 0) {
      document.addEventListener("keydown", dismissTopPanel);
      document.addEventListener("keydown", dismissCapturePanel, true);
      window.addEventListener("keydown", dismissNativePanel, true);
    }
    openPanels.add(panel);
    return () => {
      openPanels.delete(panel);
      if (openPanels.size === 0) {
        document.removeEventListener("keydown", dismissTopPanel);
        document.removeEventListener("keydown", dismissCapturePanel, true);
        window.removeEventListener("keydown", dismissNativePanel, true);
      }
    };
  }, [open, panelRef, capture]);
}
