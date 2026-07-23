"use client";

import { useCallback, useRef, useState } from "react";

import {
  resolveSheetHeightSnap,
  sheetSnapCaps,
  type SheetSnap,
} from "@/lib/sheetSnap";

// Drag gesture for the rebuilt bottom-anchored portal sheet
// (components/mobile/MobileSharedSheet.tsx). The sheet is a flex column pinned
// to the viewport bottom whose rendered height is min(content, cap); a drag
// grows/shrinks that height directly (via an inline max-height in px) instead of
// translating a viewport-tall panel. On release the drag resolves to a snap
// (peek/half/full) whose cap governs the resting max-height, or dismisses.
//
// Active only ≤640px (the phone portal); above that PubMap renders the legacy
// inline drawer with its own translateY gesture (components/map/useSheetDrag.ts).
//
// PHYSICS (Apple "Designing Fluid Interfaces"): 1:1 finger tracking (the top
// edge follows the finger via max-height), progressive rubber-band past the full
// cap, momentum-aware release (a paused finger never flings), interruptible (the
// settle is a CSS max-height transition; a re-grab reads the live rendered
// height and tracks from there).

const SHEET_GESTURE_MAX_WIDTH = 640;

// iOS-style progressive boundary resistance past the full cap (Apple rubberband).
const RUBBERBAND_CONSTANT = 0.55;

// A release preceded by a still finger should NOT fling.
const RELEASE_PAUSE_MS = 66; // ~4 frames

// Low-pass on per-move velocity so a single jittery sample can't spike the snap.
const VELOCITY_SMOOTHING = 0.55;

export interface SheetHeightDrag {
  /** Current resting snap point. */
  sheetSnap: SheetSnap;
  /** Reset to a resting snap (the sheet re-asserts "half" on each open). */
  setSheetSnap: (snap: SheetSnap) => void;
  /** Live box height (px) while dragging — applied as inline max-height. Null at rest. */
  dragHeight: number | null;
  /** Clear the live height (CSS `max-height:<cap>` owns the resting box). */
  setDragHeight: (value: number | null) => void;
  onSheetDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
}

/** Progressive resistance past a boundary (Apple rubber-band). */
function rubberband(overshoot: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * RUBBERBAND_CONSTANT) / (dimension + RUBBERBAND_CONSTANT * overshoot);
}

/** Presented (rubber-banded, non-negative) box height for a raw finger height. */
function presentHeight(raw: number, fullCap: number): number {
  const capped = raw > fullCap ? fullCap + rubberband(raw - fullCap, fullCap) : raw;
  return Math.max(0, capped);
}

/**
 * `onDismiss` fires when a drag flings/collapses the sheet past its dismiss
 * threshold (the caller clears the selected venue / closes the sheet there).
 */
export function useSheetHeightDrag(onDismiss: () => void): SheetHeightDrag {
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{
    startClientY: number;
    // Rendered box height (px) at grab — the start snap's true resting height
    // (content-hugged when short, capped when tall).
    startHeight: number;
    // Per-snap cap heights (px), resolved against the viewport at grab.
    caps: ReturnType<typeof sheetSnapCaps>;
    startSnap: SheetSnap;
    lastY: number;
    lastTime: number;
    velocity: number; // px/ms of HEIGHT (+ growing / − shrinking), low-passed
    active: boolean;
  } | null>(null);

  const gestureEnabled = useCallback(
    () => typeof window !== "undefined" && window.innerWidth <= SHEET_GESTURE_MAX_WIDTH,
    [],
  );

  const onSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!gestureEnabled()) return;
      // Interactive controls inside the header (close button, detent) initiate
      // their own actions, not the drag.
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select")) return;
      const drawer = (event.currentTarget as HTMLElement).closest<HTMLElement>(".mapDrawer");
      if (!drawer) return;
      const startHeight = drawer.getBoundingClientRect().height;
      // bottom:0 in the rebuild → dockPx 0; read it anyway so caps stay correct
      // if the anchor ever grows a safe-area offset.
      const dockPx = parseFloat(window.getComputedStyle(drawer).bottom) || 0;
      dragRef.current = {
        startClientY: event.clientY,
        startHeight,
        caps: sheetSnapCaps(window.innerHeight, dockPx),
        startSnap: sheetSnap,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocity: 0,
        active: true,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [gestureEnabled, sheetSnap],
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
      // Height grows as the finger moves UP (clientY decreases).
      const instant = (drag.lastY - event.clientY) / dt;
      drag.velocity = drag.velocity * (1 - VELOCITY_SMOOTHING) + instant * VELOCITY_SMOOTHING;
    }
    drag.lastY = event.clientY;
    drag.lastTime = now;
    const raw = drag.startHeight + (drag.startClientY - event.clientY);
    setDragHeight(presentHeight(raw, drag.caps.full));
  }, []);

  const onSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !drag.active) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDragHeight(null);

      const raw = drag.startHeight + (drag.startClientY - event.clientY);
      const releaseHeight = presentHeight(raw, drag.caps.full);
      const paused = performance.now() - drag.lastTime > RELEASE_PAUSE_MS;
      const velocity = paused ? 0 : drag.velocity;

      const { snap, dismissed } = resolveSheetHeightSnap({
        startSnap: drag.startSnap,
        startHeightPx: drag.startHeight,
        releaseHeightPx: releaseHeight,
        velocity,
        caps: drag.caps,
      });
      if (dismissed) {
        setSheetSnap("half");
        onDismiss();
        return;
      }
      setSheetSnap(snap);
    },
    [onDismiss],
  );

  return {
    sheetSnap,
    setSheetSnap,
    dragHeight,
    setDragHeight,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  };
}
