"use client";

/**
 * How far the on-screen keyboard reaches up the LAYOUT viewport.
 *
 * When the keyboard leaves the layout viewport unchanged, a composer pinned
 * to `bottom: 0` sits behind the keys. The visual
 * viewport is the part a person can still see, and its height plus its offset
 * from the top of the layout viewport say exactly how much of the bottom is
 * covered. That number is the inset a pinned composer rides up by.
 *
 * `lib/softKeyboard.ts` answers the OTHER question (is a keyboard open at all)
 * and gates the tab bar on it; this module answers the height, and it is
 * deliberately a separate leaf so a page that never pins a composer pays for
 * neither.
 *
 * When both viewports shrink together, including in the Android native shell,
 * this inset is zero. The resized layout already places the composer above
 * the keyboard.
 */

import { useSyncExternalStore } from "react";

export type ViewportEvidence = {
  /** `window.innerHeight`: the layout viewport. */
  layoutHeight: number;
  /** `visualViewport.height`: what is on screen. */
  viewportHeight: number;
  /** `visualViewport.offsetTop`: how far the visible part is scrolled down. */
  offsetTop: number;
};

/**
 * Pure. The covered strip at the bottom, in CSS pixels, never negative and
 * never fractional (a fractional inset makes a pinned bar shimmer on scroll).
 * A reading with a nonsense value answers zero rather than a guess.
 */
export function keyboardInsetPx(evidence: ViewportEvidence): number {
  const { layoutHeight, viewportHeight, offsetTop } = evidence;
  if (![layoutHeight, viewportHeight, offsetTop].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round(layoutHeight - viewportHeight - offsetTop));
}

const listeners = new Set<() => void>();
let inset = 0;

function readEvidence(): ViewportEvidence | null {
  if (typeof window === "undefined" || !window.visualViewport) return null;
  return {
    layoutHeight: window.innerHeight,
    viewportHeight: window.visualViewport.height,
    offsetTop: window.visualViewport.offsetTop,
  };
}

function refresh(): void {
  const evidence = readEvidence();
  const next = evidence ? keyboardInsetPx(evidence) : 0;
  if (next === inset) return;
  inset = next;
  for (const listener of listeners) listener();
}

/** Current answer. Zero on the server and before the first subscriber. */
export function readKeyboardInset(): number {
  return inset;
}

export function serverKeyboardInset(): number {
  return 0;
}

/**
 * Subscribe to the inset. Listeners attach for the first subscriber and detach
 * with the last. `resize` is the keyboard itself; `scroll` is iOS reporting
 * the visible part being pushed up the page.
 */
export function subscribeKeyboardInset(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    refresh();
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size > 0) return;
    window.visualViewport?.removeEventListener("resize", refresh);
    window.visualViewport?.removeEventListener("scroll", refresh);
    window.removeEventListener("resize", refresh);
    // The last subscriber leaves and nothing is listening to the viewport any
    // more, so the held figure is a MEMORY rather than an answer. `readKeyboardInset`
    // is the `getSnapshot` for `useSyncExternalStore`, so a remount with a
    // keyboard that has since closed would paint the old inset for one frame
    // before `refresh()` corrected it. Zero is what nobody-is-covered means.
    inset = 0;
  };
}

/** The inset, live. Zero wherever nothing is covered. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboardInset, readKeyboardInset, serverKeyboardInset);
}
