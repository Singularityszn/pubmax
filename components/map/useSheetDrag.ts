"use client";

import { useCallback, useRef, useState } from "react";

import { resolveSheetSnap, type SheetSnap } from "@/lib/sheetSnap";

// Mobile venue-detail bottom-sheet drag gesture (GH #17), lifted out of PubMap so
// its branch-heavy pointer handlers live off PubMap's ESLint complexity budget.
// Behaviour is byte-for-byte the same as the inline version this replaces — the
// only change is location. The gesture is active only ≤640px (matches the mobile
// breakpoint used across venueSheet.css / globals.css); above that width the panel
// is the unchanged desktop side drawer and every handler bails out immediately.
//
// PubMap owns WHICH snap is default on a fresh pick (it resets to "half" there);
// this hook owns the live drag → snap resolution and the mid-drag px offset.

// The sheet's resting translateY as a fraction of the VIEWPORT height (not the
// drawer's own 82vh-capped height — see venueSheet.css's `.sheet-*` rules, which
// these mirror exactly so a live drag lines up with the CSS-driven resting
// position it settles into on release).
const SHEET_SNAP_VH: Record<SheetSnap, number> = { full: 0, half: 0.27, peek: 0.68 };

export function sheetSnapTranslateYPx(snap: SheetSnap, viewportHeight: number): number {
  return SHEET_SNAP_VH[snap] * viewportHeight;
}

// The drag gesture is only active ≤640px.
const SHEET_GESTURE_MAX_WIDTH = 640;

export interface SheetDrag {
  /** Current resting snap point. */
  sheetSnap: SheetSnap;
  /** Reset to a resting snap (PubMap calls this "half" on a fresh venue pick). */
  setSheetSnap: (snap: SheetSnap) => void;
  /** Live px offset while a drag is in progress; null when not dragging. */
  sheetDragY: number | null;
  /** Clear the live offset (CSS owns the resting transform once cleared). */
  setSheetDragY: (value: number | null) => void;
  onSheetDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * Bottom-sheet drag state + pointer handlers. `onDismiss` fires when a drag
 * flings the sheet past its dismiss threshold (PubMap clears the selected venue
 * + closes the composer there). Pointer Events (not touch/mouse-specific) so a
 * mouse-drag on a narrow browser window works too — which keeps this testable
 * without a real touch device.
 */
export function useSheetDrag(onDismiss: () => void): SheetDrag {
  // "half" is the default resting snap whenever a venue is freshly selected —
  // PubMap re-asserts that on each pick; we just seed it here.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  const [sheetDragY, setSheetDragY] = useState<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startTime: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  const gestureEnabled = useCallback(
    () => typeof window !== "undefined" && window.innerWidth <= SHEET_GESTURE_MAX_WIDTH,
    [],
  );

  const onSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!gestureEnabled()) return;
      // Ignore drags that start on an interactive control inside the header
      // (e.g. the close button) — only the grab handle / header chrome itself
      // initiates the gesture, so tab/button clicks are unaffected.
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select")) return;
      const now = performance.now();
      dragRef.current = {
        startY: event.clientY,
        startTime: now,
        lastY: event.clientY,
        lastTime: now,
        velocity: 0,
        active: true,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [gestureEnabled],
  );

  const onSheetDragMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || !drag.active) return;
    // Dragging the sheet must never also pan/zoom the map underneath.
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    const dt = now - drag.lastTime;
    if (dt > 0) {
      drag.velocity = (event.clientY - drag.lastY) / dt;
    }
    drag.lastY = event.clientY;
    drag.lastTime = now;
    setSheetDragY(event.clientY - drag.startY);
  }, []);

  const onSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !drag.active) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
      const result = resolveSheetSnap({
        currentSnap: sheetSnap,
        viewportHeight,
        dragDeltaY: event.clientY - drag.startY,
        velocity: drag.velocity,
      });
      setSheetDragY(null);
      if (result.dismissed) {
        onDismiss();
        return;
      }
      setSheetSnap(result.snap);
    },
    [sheetSnap, onDismiss],
  );

  return {
    sheetSnap,
    setSheetSnap,
    sheetDragY,
    setSheetDragY,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  };
}
