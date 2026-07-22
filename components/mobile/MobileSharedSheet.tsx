"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { sheetTranslateY, resolveHalfContentFit } from "@/lib/sheetSnap";
import type { MapSheetDetent, MapSheetKind } from "@/lib/mobileShell";

// The bottom-sheet gesture + content-fit model is only active on the narrow
// mobile layout (matches mobileMapShell.css / useSheetDrag's 640px gate).
const SHEET_FIT_MAX_WIDTH = 640;

// useLayoutEffect on the server logs a warning; fall back to useEffect there so
// the first measured fit still lands before paint on the client.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Resolve a CSS length (e.g. `var(--x)`) to px by measuring a hidden probe. */
function measureCssLengthPx(host: HTMLElement, value: string): number {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:${value};`;
  host.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

type SheetFit = { bodyPx: number; translatePx: number };

export default function MobileSharedSheet({ kind, title, initialSnap = "half", requestedSnap, onClose, children }: { kind: MapSheetKind | null; title: string; initialSnap?: MapSheetDetent; requestedSnap?: MapSheetDetent; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const requestClose = useCallback(() => onCloseRef.current(), []);

  // Content-fit: when a short contextual sheet (TfL live, map layers…) rests at
  // the `half` detent, hug its content instead of stretching to 55dvh and
  // leaving a white void below one card. Venue (right) / planner (left) keep
  // their full-height, footer-docked contract untouched — #536's command-bar
  // reserved-space math depends on the fixed body height, so fit never touches
  // them.
  const isContextual = kind !== null && kind !== "venue" && kind !== "planner";
  const [fit, setFit] = useState<SheetFit | null>(null);

  // Feed the fit's resting position into the drag gesture so the hugged sheet is
  // treated as the half detent's true home (a tap settles back to it, not down
  // to peek; a full→half release lands on content). Only while resting at half.
  const halfOverride = fit && isContextual ? fit.translatePx : null;
  const { sheetSnap, setSheetSnap, sheetDragY, setSheetDragY, onSheetDragStart, onSheetDragMove, onSheetDragEnd } = useSheetDrag(requestClose, halfOverride);

  const measureFit = useCallback(() => {
    const sheet = sheetRef.current;
    const header = headerRef.current;
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!sheet || !header || !body || !content || typeof window === "undefined") return;
    if (!isContextual || window.innerWidth > SHEET_FIT_MAX_WIDTH) {
      setFit(null);
      return;
    }
    // Measure the content's NATURAL height off the inner wrapper (a plain block
    // whose height is content-driven), never the body — the body box is clamped
    // or fit-overridden, so its scrollHeight would report the box, not content.
    const cs = window.getComputedStyle(body);
    const paddingV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const next = resolveHalfContentFit({
      viewportHeight: window.innerHeight,
      headerHeight: header.offsetHeight,
      dockClearance: measureCssLengthPx(sheet, "var(--mobile-map-dock-clearance)"),
      contentHeight: content.offsetHeight + paddingV,
    });
    setFit((prev) => (prev && next && prev.bodyPx === next.bodyPx && prev.translatePx === next.translatePx ? prev : next));
  }, [isContextual]);

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

  // Measure on open + whenever the content resizes (async TfL load, theme, etc.)
  // or the viewport changes. Observe the inner content wrapper — never the body
  // whose height fit itself overrides — to avoid a ResizeObserver feedback loop.
  useIsomorphicLayoutEffect(() => {
    if (!kind) return;
    measureFit();
    const content = contentRef.current;
    const onResize = () => measureFit();
    window.addEventListener("resize", onResize);
    if (!content || typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver(() => measureFit());
    observer.observe(content);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [kind, measureFit]);

  // Modal trap only at the `full` detent (where the sheet covers ~the whole
  // viewport). Shared with the desktop venue drawer via useFocusTrap.
  useFocusTrap(Boolean(kind) && sheetSnap === "full", sheetRef);

  if (!kind || typeof document === "undefined") return null;
  const closeLabel = kind === "venue" ? "Close pub detail" : kind === "planner" ? "Close planner" : `Close ${title}`;

  // Fit only governs the resting `half` detent and yields the moment a drag
  // starts — full/peek and the live drag transform stay authoritative.
  const fitActive = fit !== null && isContextual && sheetSnap === "half" && sheetDragY === null;
  const sectionStyle: React.CSSProperties | undefined = sheetDragY !== null
    ? { transform: `translateY(${Math.max(0, sheetTranslateY(sheetSnap, window.innerHeight) + sheetDragY)}px)`, transition: "none" }
    : fitActive
      ? { transform: `translateY(${fit.translatePx}px)` }
      : undefined;

  return createPortal(
    <div ref={portalRef} className="mobileSheetPortal" data-sheet-kind={kind}>
      <button className="mobileSheetScrim" type="button" tabIndex={sheetSnap === "full" ? -1 : 0} onClick={requestClose} aria-label={`Dismiss ${title} backdrop`} />
      <section
        ref={sheetRef}
        className={`mapDrawer mobileSharedSheet ${kind === "venue" ? "right" : kind === "planner" ? "left" : "contextual"} open sheet-${sheetSnap}${sheetDragY !== null ? " sheet-dragging" : ""}${fitActive ? " sheet-fit" : ""}`}
        role={sheetSnap === "full" ? "dialog" : undefined}
        aria-modal={sheetSnap === "full" ? "true" : undefined}
        aria-labelledby={titleId}
        style={sectionStyle}
      >
        <header ref={headerRef} className="mobileSharedSheetHeader sheetDragHandle" onPointerDown={onSheetDragStart} onPointerMove={onSheetDragMove} onPointerUp={onSheetDragEnd} onPointerCancel={onSheetDragEnd}>
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
        <div
          ref={bodyRef}
          className={`mobileSharedSheetBody${sheetSnap === "full" ? " isScrollable" : ""}`}
          style={fitActive ? { flex: "0 0 auto", height: `${fit.bodyPx}px` } : undefined}
        >
          {/* Only contextual sheets get the measuring wrapper. Venue/planner
              render children directly so their `position: sticky` footer dock
              (#536) keeps the exact DOM/containing-block it relies on. */}
          {isContextual ? <div ref={contentRef}>{children}</div> : children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
