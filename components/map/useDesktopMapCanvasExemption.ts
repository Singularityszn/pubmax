"use client";

import { useEffect, type RefObject } from "react";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";

/** Keep the visible map interactive beside the desktop venue drawer. */
export function useDesktopMapCanvasExemption(toolbarRef: RefObject<HTMLElement | null>, detailOpen: boolean, desktop: boolean) {
  useEffect(() => {
    const shell = toolbarRef.current?.closest<HTMLElement>(".appShell");
    if (!detailOpen || !desktop || !shell) return;
    let marked: HTMLElement | null = null;
    let owned = false;
    const release = () => {
      if (owned) marked?.removeAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE);
      marked = null;
      owned = false;
    };
    const sync = () => {
      const canvas = shell.querySelector(":scope > .mapSplitList")
        ? shell.querySelector<HTMLElement>(".maplibreMap") : null;
      if (canvas === marked) return;
      release();
      if (!canvas) return;
      marked = canvas;
      owned = !canvas.hasAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE);
      if (owned) canvas.setAttribute(FOCUS_TRAP_EXEMPT_ATTRIBUTE, "");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, { childList: true, subtree: true });
    return () => { observer.disconnect(); release(); };
  }, [desktop, detailOpen, toolbarRef]);
}
