"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useSheetHeightDrag } from "@/components/mobile/useSheetHeightDrag";
import { SheetFooterContext } from "@/components/mobile/sheetFooterContext";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { MapSheetDetent, MapSheetKind } from "@/lib/mobileShell";

/**
 * The mobile bottom sheet, rebuilt as a bottom-anchored flex column:
 *
 *   header (auto) / body (flex-1, min-height:0, overflow-auto) / footer (auto)
 *
 * The CONTAINER height is content-driven with `max-height: <snap cap>` (CSS,
 * mobileMapShell.css), so the sheet's rendered height is min(natural content,
 * cap): short content HUGS (no void) and tall content caps and scrolls inside
 * the body while header + footer stay pinned. There is no content measuring, no
 * translateY snap panel, and no reserved dock band — the box's visible bottom
 * edge is the viewport bottom and the last content pixel sits exactly a
 * safe-area inset above it. A drag grows/shrinks the box height directly
 * (useSheetHeightDrag writes an inline max-height in px); a release settles to a
 * snap cap. The footer slot holds the venue command bar (portaled in via
 * SheetFooterContext); contextual + planner sheets have no footer.
 */
export default function MobileSharedSheet({
  kind,
  title,
  initialSnap = "half",
  requestedSnap,
  onClose,
  closeLabel,
  children,
}: {
  kind: MapSheetKind | null;
  title: string;
  initialSnap?: MapSheetDetent;
  requestedSnap?: MapSheetDetent;
  onClose: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const finishClose = useCallback(() => onCloseRef.current(), []);

  const {
    sheetSnap,
    setSheetSnap,
    openAtSnap,
    requestDismiss,
    sheetHeight,
    dragging,
    settling,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  } = useSheetHeightDrag(finishClose);
  const requestClose = useCallback(() => {
    requestDismiss(sheetRef.current?.getBoundingClientRect().height);
  }, [requestDismiss]);

  // On open: capture focus origin, reset to the requested opening snap, focus
  // the close button, and wire Escape-to-close.
  useEffect(() => {
    if (!kind) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openAtSnap(initialSnap);
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
  }, [initialSnap, kind, openAtSnap, requestClose]);

  // PubMap/MobileMapShell can request a snap change (e.g. a content-tab tap
  // expands the venue sheet to full). Only re-applies on change.
  useEffect(() => {
    if (!kind || !requestedSnap) return;
    setSheetSnap(requestedSnap);
  }, [kind, requestedSnap, setSheetSnap]);

  // Modal focus trap only at the `full` detent (near-fullscreen).
  useFocusTrap(Boolean(kind) && sheetSnap === "full", sheetRef);

  if (!kind || typeof document === "undefined") return null;
  const closeButtonLabel =
    closeLabel ??
    (kind === "venue"
      ? "Close venue detail"
      : kind === "planner"
        ? "Close planner"
        : `Close ${title}`);

  const sectionStyle: React.CSSProperties = {
    maxHeight: `${Math.max(0, sheetHeight)}px`,
  };

  return createPortal(
    <div className="mobileSheetPortal" data-sheet-kind={kind}>
      <button
        className="mobileSheetScrim"
        type="button"
        tabIndex={sheetSnap === "full" ? -1 : 0}
        onClick={requestClose}
        aria-label={`Dismiss ${title} backdrop`}
      />
      <section
        ref={sheetRef}
        className={`mapDrawer mobileSharedSheet ${kind === "venue" ? "right" : kind === "planner" ? "left" : "contextual"} open sheet-${sheetSnap}${dragging ? " sheet-dragging" : ""}${settling ? " sheet-settling" : ""}`}
        role={sheetSnap === "full" ? "dialog" : undefined}
        aria-modal={sheetSnap === "full" ? "true" : undefined}
        aria-labelledby={titleId}
        style={sectionStyle}
      >
        <header
          className="mobileSharedSheetHeader sheetDragHandle"
          onPointerDown={onSheetDragStart}
          onPointerMove={onSheetDragMove}
          onPointerUp={onSheetDragEnd}
          onPointerCancel={onSheetDragEnd}
        >
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
          >
            <span className="mobileSharedSheetGrab" aria-hidden="true" />
          </button>
          <h2 id={titleId}>{title}</h2>
          <IconButton ref={closeRef} className="mobileSharedSheetClose" aria-label={closeButtonLabel} onClick={requestClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="mobileSharedSheetBody">
          <SheetFooterContext.Provider value={footerEl}>{children}</SheetFooterContext.Provider>
        </div>
        {/* Footer slot: the venue command bar portals in here (SheetFooterContext)
            so it is a real flex child BELOW the scroll body — always visible, in
            flow with the sheet during drag/snap. Empty (and CSS-collapsed) for
            contextual + planner sheets. */}
        <div className="mobileSharedSheetFooter" ref={setFooterEl} />
      </section>
    </div>,
    document.body,
  );
}
