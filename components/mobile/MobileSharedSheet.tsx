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

type SheetFit = {
  bodyPx: number;
  translatePx: number;
  /**
   * Docked command-bar bottom offset (px, relative to the transformed sheet) for
   * the hugged venue sheet — bar bottom = translatePx + dockClearance so the
   * Drop/Share bar rides at the content's bottom. null for footerless contextual
   * sheets, which have no docked bar to reposition.
   */
  barBottomPx: number | null;
};

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

  // Content-fit: when a short sheet rests at the `half` detent, hug its content
  // instead of stretching to 55dvh and leaving a white void. Contextual sheets
  // (TfL live, map layers…) hug the plain body. VENUE (right) also hugs (owner
  // ruling, "Kings Head" screenshot): its fixed Drop/Share command bar (#536)
  // then rides at the content's bottom via `barBottomPx` instead of the fixed
  // 55dvh line. Planner (left) stays exempt — its footer contract is untouched.
  const isContextual = kind !== null && kind !== "venue" && kind !== "planner";
  const isVenue = kind === "venue";
  const fitEnabled = isContextual || isVenue;
  const [fit, setFit] = useState<SheetFit | null>(null);

  // Feed the fit's resting position into the drag gesture so the hugged sheet is
  // treated as the half detent's true home (a tap settles back to it, not down
  // to peek; a full→half release lands on content). Only while resting at half.
  const halfOverride = fit && fitEnabled ? fit.translatePx : null;
  const { sheetSnap, setSheetSnap, sheetDragY, setSheetDragY, onSheetDragStart, onSheetDragMove, onSheetDragEnd } = useSheetDrag(requestClose, halfOverride);

  const measureFit = useCallback(() => {
    const sheet = sheetRef.current;
    const header = headerRef.current;
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!sheet || !header || !body || !content || typeof window === "undefined") return;
    if (!fitEnabled || window.innerWidth > SHEET_FIT_MAX_WIDTH) {
      setFit(null);
      return;
    }
    // Measure the content's NATURAL height off the inner wrapper (a plain block
    // whose height is content-driven), never the body — the body box is clamped
    // or fit-overridden, so its scrollHeight would report the box, not content.
    const cs = window.getComputedStyle(body);
    const paddingV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const dockClearance = measureCssLengthPx(sheet, "var(--mobile-map-dock-clearance)");
    // Venue reserves a fixed command-bar strip (--venue-cmdbar-h) below the body;
    // that footer shortens the fit's room and lifts the hugged sheet by its height
    // so the bar (not the body) lands the dock clearance above the tab bar.
    const footerHeight = isVenue ? measureCssLengthPx(sheet, "var(--venue-cmdbar-h)") : 0;
    const base = resolveHalfContentFit({
      viewportHeight: window.innerHeight,
      headerHeight: header.offsetHeight,
      dockClearance,
      contentHeight: content.offsetHeight + paddingV,
      footerHeight,
    });
    const next: SheetFit | null = base
      ? { ...base, barBottomPx: isVenue ? base.translatePx + dockClearance : null }
      : null;
    setFit((prev) =>
      prev && next && prev.bodyPx === next.bodyPx && prev.translatePx === next.translatePx && prev.barBottomPx === next.barBottomPx
        ? prev
        : next,
    );
  }, [fitEnabled, isVenue]);

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
  const fitActive = fit !== null && fitEnabled && sheetSnap === "half" && sheetDragY === null;
  const sectionStyle: React.CSSProperties | undefined = sheetDragY !== null
    ? { transform: `translateY(${Math.max(0, sheetTranslateY(sheetSnap, window.innerHeight) + sheetDragY)}px)`, transition: "none" }
    : fitActive
      ? {
          transform: `translateY(${fit.translatePx}px)`,
          // Venue only: park the fixed Drop/Share bar at the hugged content's
          // bottom (consumed by .sheet-fit .venueSheetStickyBar in venueSheet.css).
          ...(fit.barBottomPx !== null
            ? ({ ["--venue-fit-bar-bottom"]: `${fit.barBottomPx}px` } as React.CSSProperties)
            : null),
        }
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
          {/* Contextual sheets and the venue sheet get the measuring wrapper.
              The wrapper is a plain block (no transform/filter), so the venue's
              fixed Drop/Share command bar (#536) still resolves against the
              transformed sheet — the containing block it relies on — and the bar,
              being out of flow, never inflates the measured content height.
              Planner (left) still renders children directly. */}
          {fitEnabled ? <div ref={contentRef}>{children}</div> : children}
        </div>
      </section>
    </div>,
    document.body,
  );
}
