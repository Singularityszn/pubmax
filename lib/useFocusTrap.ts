"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared modal focus trap, extracted from the mobile bottom sheet
// (MobileSharedSheet) so the desktop venue drawer can reuse the SAME behaviour
// for its full open lifetime. While `active`:
//   1. Tab / Shift+Tab cycle within `containerRef`'s visible focusables.
//   2. Everything OUTSIDE the container is marked `inert` — walking the ancestor
//      chain to <body> and inert-ing each level's off-path siblings. This works
//      whether the trapped node is a body-level portal (mobile sheet) or nested
//      inside the app shell (desktop drawer). Prior `inert` values are restored
//      on teardown.
// Focus capture/restore and Esc stay with each caller (both surfaces already
// own those); this hook is ONLY the trap.
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    // Inert every element outside the container: at each level from the
    // container up to <body>, inert the off-path siblings.
    const inerted: { node: HTMLElement; prev: boolean }[] = [];
    let cursor: HTMLElement | null = container;
    while (cursor && cursor !== document.body) {
      const parent: HTMLElement | null = cursor.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === cursor || !(sibling instanceof HTMLElement)) continue;
        inerted.push({ node: sibling, prev: sibling.inert });
        sibling.inert = true;
      }
      cursor = parent;
    }

    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
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
    };
  }, [active, containerRef]);
}
