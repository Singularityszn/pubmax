"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { sheetTranslateY } from "@/lib/sheetSnap";
import type { MapSheetDetent, MapSheetKind } from "@/lib/mobileShell";

export default function MobileSharedSheet({ kind, title, initialSnap = "half", requestedSnap, onClose, children }: { kind: MapSheetKind | null; title: string; initialSnap?: MapSheetDetent; requestedSnap?: MapSheetDetent; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const { sheetSnap, setSheetSnap, sheetDragY, setSheetDragY, onSheetDragStart, onSheetDragMove, onSheetDragEnd } = useSheetDrag(onClose);

  useEffect(() => {
    if (!kind) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheetSnap(initialSnap);
    setSheetDragY(null);
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [initialSnap, kind, onClose, setSheetDragY, setSheetSnap]);

  useEffect(() => {
    if (!kind || !requestedSnap) return;
    setSheetDragY(null);
    setSheetSnap(requestedSnap);
  }, [kind, requestedSnap, setSheetDragY, setSheetSnap]);

  if (!kind || typeof document === "undefined") return null;
  const closeLabel = kind === "venue" ? "Close pub detail" : kind === "planner" ? "Close planner" : `Close ${title}`;

  return createPortal(
    <div className="mobileSheetPortal" data-sheet-kind={kind}>
      <button className="mobileSheetScrim" type="button" onClick={onClose} aria-label={`Dismiss ${title} backdrop`} />
      <section
        className={`mapDrawer mobileSharedSheet ${kind === "venue" ? "right" : kind === "planner" ? "left" : "contextual"} open sheet-${sheetSnap}${sheetDragY !== null ? " sheet-dragging" : ""}`}
        role={sheetSnap === "full" ? "dialog" : undefined}
        aria-modal={sheetSnap === "full" ? "true" : undefined}
        aria-labelledby={titleId}
        style={sheetDragY !== null ? { transform: `translateY(${Math.max(0, sheetTranslateY(sheetSnap, window.innerHeight) + sheetDragY)}px)`, transition: "none" } : undefined}
      >
        <header className="mobileSharedSheetHeader sheetDragHandle" onPointerDown={onSheetDragStart} onPointerMove={onSheetDragMove} onPointerUp={onSheetDragEnd} onPointerCancel={onSheetDragEnd}>
          <span className="mobileSharedSheetGrab" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          <IconButton ref={closeRef} className="mobileSharedSheetClose" aria-label={closeLabel} onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className={`mobileSharedSheetBody${sheetSnap === "full" ? " isScrollable" : ""}`}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
