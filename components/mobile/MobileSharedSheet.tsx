"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { sheetTranslateY } from "@/lib/sheetSnap";
import type { MapSheetDetent, MapSheetKind } from "@/lib/mobileShell";

export default function MobileSharedSheet({ kind, title, initialSnap = "half", requestedSnap, onClose, children }: { kind: MapSheetKind | null; title: string; initialSnap?: MapSheetDetent; requestedSnap?: MapSheetDetent; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const requestClose = useCallback(() => onCloseRef.current(), []);
  const { sheetSnap, setSheetSnap, sheetDragY, setSheetDragY, onSheetDragStart, onSheetDragMove, onSheetDragEnd } = useSheetDrag(requestClose);

  useEffect(() => {
    if (!kind) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheetSnap(initialSnap);
    setSheetDragY(null);
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [initialSnap, kind, requestClose, setSheetDragY, setSheetSnap]);

  useEffect(() => {
    if (!kind || !requestedSnap) return;
    setSheetDragY(null);
    setSheetSnap(requestedSnap);
  }, [kind, requestedSnap, setSheetDragY, setSheetSnap]);

  useEffect(() => {
    if (!kind || sheetSnap !== "full") return;
    const portal = portalRef.current;
    const sheet = sheetRef.current;
    if (!portal || !sheet) return;
    const background = [...document.body.children].filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== portal,
    );
    const previous = background.map((node) => ({ node, inert: node.inert }));
    for (const { node } of previous) node.inert = true;
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((node) => node.offsetParent !== null);
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
    sheet.addEventListener("keydown", onTab);
    return () => {
      sheet.removeEventListener("keydown", onTab);
      for (const item of previous) item.node.inert = item.inert;
    };
  }, [kind, sheetSnap]);

  if (!kind || typeof document === "undefined") return null;
  const closeLabel = kind === "venue" ? "Close pub detail" : kind === "planner" ? "Close planner" : `Close ${title}`;

  return createPortal(
    <div ref={portalRef} className="mobileSheetPortal" data-sheet-kind={kind}>
      <button className="mobileSheetScrim" type="button" tabIndex={sheetSnap === "full" ? -1 : 0} onClick={requestClose} aria-label={`Dismiss ${title} backdrop`} />
      <section
        ref={sheetRef}
        className={`mapDrawer mobileSharedSheet ${kind === "venue" ? "right" : kind === "planner" ? "left" : "contextual"} open sheet-${sheetSnap}${sheetDragY !== null ? " sheet-dragging" : ""}`}
        role={sheetSnap === "full" ? "dialog" : undefined}
        aria-modal={sheetSnap === "full" ? "true" : undefined}
        aria-labelledby={titleId}
        style={sheetDragY !== null ? { transform: `translateY(${Math.max(0, sheetTranslateY(sheetSnap, window.innerHeight) + sheetDragY)}px)`, transition: "none" } : undefined}
      >
        <header className="mobileSharedSheetHeader sheetDragHandle" onPointerDown={onSheetDragStart} onPointerMove={onSheetDragMove} onPointerUp={onSheetDragEnd} onPointerCancel={onSheetDragEnd}>
          <button
            type="button"
            className="mobileSharedSheetDetent"
            aria-label={sheetSnap === "full" ? "Collapse sheet" : "Expand sheet"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSheetSnap(sheetSnap === "full" ? "half" : "full")}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") setSheetSnap("full");
              if (event.key === "ArrowDown") setSheetSnap(sheetSnap === "peek" ? "peek" : "half");
            }}
          ><span className="mobileSharedSheetGrab" aria-hidden="true" /></button>
          <h2 id={titleId}>{title}</h2>
          <IconButton ref={closeRef} className="mobileSharedSheetClose" aria-label={closeLabel} onClick={requestClose}><X size={18} /></IconButton>
        </header>
        <div className={`mobileSharedSheetBody${sheetSnap === "full" ? " isScrollable" : ""}`}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
