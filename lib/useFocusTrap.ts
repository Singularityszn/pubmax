"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A trap may only stand the rest of the page down when its own container is
 * on screen. The phone sheet portal stays MOUNTED at desktop widths and CSS
 * hides it (`display: none`, mobileMapShell.css). Its React state still runs,
 * so a sheet opened at the `full` detent used to inert the whole desktop app
 * behind a surface nobody could see: every pin, the toolbar search, and the
 * desktop Pint Drop picker's own rows went unclickable and unfocusable.
 * `displayChain` is the computed `display` of the container and each ancestor.
 */
export function shouldEngageFocusTrap(input: {
  active: boolean;
  displayChain: string[];
}): boolean {
  if (!input.active) return false;
  return !input.displayChain.includes("none");
}

export type FocusTrapOutsidePolicy = "strict-modal" | "map-surface";

const strictModalListeners = new Set<() => void>();
let strictModalTrapCount = 0;
let strictModalTrapRevision = 0;

export function subscribeStrictModalFocusTrap(listener: () => void): () => void {
  strictModalListeners.add(listener);
  return () => strictModalListeners.delete(listener);
}

export function readStrictModalFocusTrap(): boolean {
  return strictModalTrapCount > 0;
}

export function serverStrictModalFocusTrap(): boolean {
  return false;
}

export function readStrictModalFocusTrapRevision(): number {
  return strictModalTrapRevision;
}

export function serverStrictModalFocusTrapRevision(): number {
  return 0;
}

export function strictModalAllowsSurfaceRequest(input: {
  requestRevision: number | null;
  strictModalActive: boolean;
  strictModalRevision: number;
}): boolean {
  return (
    input.requestRevision !== null &&
    !input.strictModalActive &&
    input.requestRevision === input.strictModalRevision
  );
}

function publishStrictModalFocusTrap(): void {
  strictModalTrapRevision += 1;
  for (const listener of strictModalListeners) listener();
}

function claimStrictModalFocusTrap(): () => void {
  strictModalTrapCount += 1;
  publishStrictModalFocusTrap();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    strictModalTrapCount -= 1;
    publishStrictModalFocusTrap();
  };
}

/** Body-level siblings that may stay interactive only beside a map surface. */
export function shouldInertOutsideSibling(
  node: HTMLElement,
  outsidePolicy: FocusTrapOutsidePolicy,
): boolean {
  if (outsidePolicy === "strict-modal") return true;
  return !(
    node.classList.contains("mobileTabBar") ||
    node.classList.contains("accountOnboardingBackdrop")
  );
}

function displayChain(container: HTMLElement): string[] {
  const chain: string[] = [];
  let cursor: HTMLElement | null = container;
  while (cursor) {
    chain.push(window.getComputedStyle(cursor).display);
    cursor = cursor.parentElement;
  }
  return chain;
}

// Shared modal focus trap, extracted from the mobile bottom sheet
// (MobileSharedSheet) so the desktop venue drawer can reuse the SAME behaviour
// for its full open lifetime. While `active`:
//   1. Tab / Shift+Tab cycle within `containerRef`'s visible focusables.
//   2. Everything OUTSIDE the container is marked `inert` — walking the ancestor
//      chain to <body> and inert-ing each level's off-path siblings. This works
//      whether the trapped node is a body-level portal (mobile sheet) or nested
//      inside the app shell (desktop drawer). Prior `inert` values are restored
//      on teardown.
//   3. A container CSS has hidden never traps at all (shouldEngageFocusTrap).
// Focus capture/restore and Esc stay with each caller (both surfaces already
// own those); this hook is ONLY the trap.
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  outsidePolicy: FocusTrapOutsidePolicy = "strict-modal",
): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    if (!shouldEngageFocusTrap({ active, displayChain: displayChain(container) })) return;

    // Inert every element outside the container: at each level from the
    // container up to <body>, inert the off-path siblings.
    const inerted: { node: HTMLElement; prev: boolean }[] = [];
    let cursor: HTMLElement | null = container;
    while (cursor && cursor !== document.body) {
      const parent: HTMLElement | null = cursor.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === cursor || !(sibling instanceof HTMLElement)) continue;
        if (!shouldInertOutsideSibling(sibling, outsidePolicy)) continue;
        inerted.push({ node: sibling, prev: sibling.inert });
        sibling.inert = true;
      }
      cursor = parent;
    }
    const releaseStrictModal =
      outsidePolicy === "strict-modal" ? claimStrictModalFocusTrap() : null;

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", onTab);
    return () => {
      container.removeEventListener("keydown", onTab);
      for (const item of inerted) item.node.inert = item.prev;
      releaseStrictModal?.();
    };
  }, [active, containerRef, outsidePolicy]);
}
