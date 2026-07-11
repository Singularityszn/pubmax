"use client";

import { useCallback, useRef, useState } from "react";

import { resolveSheetSnap, type SheetSnap } from "@/lib/sheetSnap";

// Mobile bottom-sheet drag gesture (GH #17), lifted out of PubMap so its
// branch-heavy pointer handlers live off PubMap's ESLint complexity budget.
// Reusable for both drawers: venue detail (right) and crawl planner (left).
// Call once per sheet — each instance owns its own snap + mid-drag offset.
// The gesture is active only ≤640px (matches venueSheet.css / globals.css);
// above that width the panel is the unchanged desktop side drawer and every
// handler bails out immediately.
//
// PubMap owns WHICH snap is default on open (it resets to "half" there);
// this hook owns the live drag → snap resolution and the mid-drag px offset.
// Mid-drag translateY px use `sheetTranslateY` from lib/sheetSnap.ts (same
// fractions as CSS `.sheet-*` and resolveSheetSnap) — do not reintroduce a
// local VH map.

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
 * / closes the planner there). Pointer Events (not touch/mouse-specific) so a
 * mouse-drag on a narrow browser window works too — which keeps this testable
 * without a real touch device.
 */
export function useSheetDrag(onDismiss: () => void): SheetDrag {
  // "half" is the default resting snap whenever a sheet opens — PubMap
  // re-asserts that on each open; we just seed it here.
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
        setSheetSnap("half");
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
