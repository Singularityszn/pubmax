"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  resolveSheetHeightSnap,
  SHEET_ENTRANCE_MS,
  sheetSnapCaps,
  type SheetSnap,
} from "@/lib/sheetSnap";
import { isTextEntryElement, readSoftKeyboardOpen, serverSoftKeyboardOpen, subscribeSoftKeyboard } from "@/lib/softKeyboard";
import { useSpringValue } from "@/lib/useSpringValue";

// Drag gesture for the bottom-anchored portal sheet. Pointer travel controls
// presented height one-to-one. Release velocity selects a projected snap and
// hands the same velocity into an interruptible spring.

const SHEET_GESTURE_MAX_WIDTH = 640;
const RUBBERBAND_CONSTANT = 0.55;
const RELEASE_PAUSE_MS = 66;
const VELOCITY_SMOOTHING = 0.55;
const MOMENTUM_VELOCITY_THRESHOLD = 0.5;

export interface SheetHeightDrag {
  sheetSnap: SheetSnap;
  setSheetSnap: (snap: SheetSnap) => void;
  settleToRest: (snap?: SheetSnap) => void;
  openAtSnap: (snap: SheetSnap) => void;
  requestDismiss: (presentedHeight?: number) => void;
  recapToViewport: () => void;
  sheetHeight: number;
  dragging: boolean;
  settling: boolean;
  /** True for the entrance animation's own duration — see openAtSnap. */
  entering: boolean;
  onSheetDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragMove: (event: React.PointerEvent<HTMLElement>) => void;
  onSheetDragEnd: (event: React.PointerEvent<HTMLElement>) => void;
}

function rubberband(overshoot: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return (
    (overshoot * dimension * RUBBERBAND_CONSTANT) /
    (dimension + RUBBERBAND_CONSTANT * overshoot)
  );
}

// What a resting sheet must always show: its header and footer, the body's
// own padding and the sheet's border. A sheet with a command bar in its footer
// peeks at exactly its header and that bar, so no body row is ever cut.
function sheetChrome(sheet: HTMLElement | null | undefined): { chromePx: number; barsPx: number | null } {
  const body = sheet?.querySelector<HTMLElement>(":scope > .mobileSharedSheetBody");
  const footer = sheet?.querySelector<HTMLElement>(":scope > .mobileSharedSheetFooter");
  if (!sheet || !body) return { chromePx: 0, barsPx: null };
  const { paddingTop, paddingBottom } = getComputedStyle(body);
  let bars = sheet.offsetHeight - sheet.clientHeight;
  for (const child of sheet.children) {
    if (child !== body) bars += (child as HTMLElement).offsetHeight;
  }
  return {
    chromePx: bars + Number.parseFloat(paddingTop) + Number.parseFloat(paddingBottom),
    barsPx: footer && footer.offsetHeight > 0 ? bars : null,
  };
}

function presentHeight(raw: number, fullCap: number): number {
  const capped =
    raw > fullCap
      ? fullCap + rubberband(raw - fullCap, fullCap)
      : raw;
  return Math.max(0, capped);
}

export function useSheetHeightDrag(onDismiss: () => void): SheetHeightDrag {
  const keyboardOpen = useSyncExternalStore(subscribeSoftKeyboard, readSoftKeyboardOpen, serverSoftKeyboardOpen);
  const [sheetSnap, setRestingSnap] = useState<SheetSnap>("half");
  const [dragging, setDragging] = useState(false);
  const [entering, setEntering] = useState(false);
  const enteringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  const dismissingRef = useRef(false);
  const {
    value: sheetHeight,
    running: settling,
    animateTo,
    jumpTo,
    stop,
  } = useSpringValue(0, { response: 0.34, dampingRatio: 1 });
  const dragRef = useRef<{
    viewportHeight: number;
    startClientY: number;
    startHeight: number;
    caps: ReturnType<typeof sheetSnapCaps>;
    startSnap: SheetSnap;
    lastY: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const gestureEnabled = useCallback(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth <= SHEET_GESTURE_MAX_WIDTH,
    [],
  );

  const capsForViewport = useCallback(() => {
    const viewport = typeof window === "undefined" ? 0 : window.innerHeight;
    const portal = typeof document === "undefined" ? null : document.querySelector(".mobileSheetPortal");
    const dock = portal && !readSoftKeyboardOpen() ? Number.parseFloat(getComputedStyle(portal).bottom) || 0 : 0;
    const { chromePx, barsPx } = sheetChrome(portal?.querySelector<HTMLElement>(".mobileSharedSheet"));
    const caps = sheetSnapCaps(viewport, dock, chromePx);
    return barsPx === null ? caps : { ...caps, peek: barsPx };
  }, []);

  // Both of these SPRING the height, so the entrance's transform stands down
  // first: a sheet sliding up while its box grows is two travels at once.
  const setSheetSnap = useCallback(
    (snap: SheetSnap) => {
      dismissingRef.current = false;
      setRestingSnap(snap);
      setEntering(false);
      animateTo(capsForViewport()[snap], { dampingRatio: 1 });
    },
    [animateTo, capsForViewport],
  );

  const settleToRest = useCallback((targetSnap: SheetSnap = sheetSnap) => {
    dismissingRef.current = false;
    setRestingSnap(targetSnap);
    setEntering(false);
    stop();
    animateTo(capsForViewport()[targetSnap], { dampingRatio: 1 });
  }, [animateTo, capsForViewport, sheetSnap, stop]);

  // THE ENTRANCE MOVES THE SHEET, NEVER THE LAYOUT.
  //
  // This sheet is bottom-anchored and its box height IS its presentation, so
  // springing that height from ~0 to the snap cap moved every pixel of content
  // inside it and Chrome scored the whole travel as layout shift: measured on
  // the audit's phone rig, a `/map?sel=` arrival recorded CLS 0.31, of which the
  // entrance alone was 0.07 and the rest was the sheet growing again when the
  // venue panel's chunk landed. Only transform and opacity are exempt from that
  // score, so the entrance is now a transform (`.sheet-entering` in
  // components/mobile/mobileMapShell.css) and the height is set AT ONCE: the
  // sheet is laid out at its resting snap on its first painted frame, which is
  // an insertion rather than a move, and slides up from below the fold.
  //
  // Everything else here still owns the height: a drag tracks the finger 1:1
  // and a release springs to the resolved snap, both of which carry recent
  // input and are excluded from CLS by construction.
  const openAtSnap = useCallback(
    (snap: SheetSnap) => {
      dismissingRef.current = false;
      setRestingSnap(snap);
      stop();
      jumpTo(capsForViewport()[snap]);
      setEntering(true);
      if (enteringTimer.current) clearTimeout(enteringTimer.current);
      enteringTimer.current = setTimeout(
        () => setEntering(false),
        SHEET_ENTRANCE_MS,
      );
    },
    [capsForViewport, jumpTo, stop],
  );

  useEffect(() => () => {
    if (enteringTimer.current) clearTimeout(enteringTimer.current);
  }, []);

  // THE VIEWPORT CAN SHRINK UNDER AN OPEN SHEET, AND THE SHEET FOLLOWS IT.
  //
  // The resting height is a px value (openAtSnap jumps to it, for the CLS
  // reasons above) applied inline, so it outranks the `dvh` caps in the
  // stylesheet and does not move when the layout viewport does. iOS Safari
  // and Android Chrome never shrink the layout viewport for the keyboard, so
  // the web never saw it. The Android WebView inside the Capacitor shell DOES:
  // the OS resizes the WebView by the keyboard's height, `window.innerHeight`
  // drops by about 235px on a Pixel 7, and a full sheet still 711px tall was
  // pushed 237px above the top edge with its header and the field being typed
  // into (docs/proof/mobile-app-design/android-emu-pixel7/composer/). A resize
  // is nobody's gesture, so the height JUMPS to the new cap rather than
  // springing, and the field that holds focus is brought back into its
  // scroller the way the browser does for the document itself.
  const sheetHeightRef = useRef(sheetHeight);
  const sheetSnapRef = useRef(sheetSnap);
  useEffect(() => {
    sheetHeightRef.current = sheetHeight;
    sheetSnapRef.current = sheetSnap;
  }, [sheetHeight, sheetSnap]);
  // The sheet's own header and footer can grow too (the venue command bar lands
  // after the sheet opens), so MobileSharedSheet calls this when they resize.
  const recapToViewport = useCallback(() => {
    if (dragRef.current?.active || dismissingRef.current) return;
    if (sheetHeightRef.current <= 0) return;
    const cap = capsForViewport()[sheetSnapRef.current];
    if (Math.abs(cap - sheetHeightRef.current) < 1) return;
    stop();
    jumpTo(cap);
    const focused = document.activeElement;
    if (focused && isTextEntryElement(focused)) {
      window.requestAnimationFrame(() => {
        if (document.activeElement === focused) {
          focused.scrollIntoView({ block: "nearest" });
        }
      });
    }
  }, [capsForViewport, jumpTo, stop]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", recapToViewport);
    // The keyboard can withdraw the dock after the viewport resize event.
    // Re-cap after that React commit too, using the portal's actual clearance.
    recapToViewport();
    return () => window.removeEventListener("resize", recapToViewport);
  }, [keyboardOpen, recapToViewport]);

  const dismissWithVelocity = useCallback(
    (velocityPxPerMillisecond: number, presentedHeight?: number) => {
      dismissingRef.current = true;
      if (presentedHeight !== undefined) {
        jumpTo(Math.max(0, presentedHeight));
      }
      animateTo(0, {
        velocity: velocityPxPerMillisecond * 1000,
        dampingRatio:
          Math.abs(velocityPxPerMillisecond) >= MOMENTUM_VELOCITY_THRESHOLD
            ? 0.8
            : 1,
        onRest: () => {
          setRestingSnap("half");
          onDismissRef.current();
        },
      });
    },
    [animateTo, jumpTo],
  );

  const requestDismiss = useCallback(
    (presentedHeight?: number) => {
      dismissWithVelocity(0, presentedHeight);
    },
    [dismissWithVelocity],
  );

  const onSheetDragStart = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!gestureEnabled()) return;
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select")) return;
      const drawer = (
        event.currentTarget as HTMLElement
      ).closest<HTMLElement>(".mapDrawer");
      if (!drawer) return;

      stop();
      dismissingRef.current = false;
      // A finger on the sheet ends the entrance: the slide is a transform and
      // the drag is a height, so leaving the class on would move the box the
      // reader is holding.
      setEntering(false);
      const startHeight = drawer.getBoundingClientRect().height;
      jumpTo(startHeight);
      dragRef.current = {
        viewportHeight: window.innerHeight,
        startClientY: event.clientY,
        startHeight,
        caps: capsForViewport(),
        startSnap: sheetSnap,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocity: 0,
        active: true,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    [capsForViewport, gestureEnabled, jumpTo, sheetSnap, stop],
  );

  const onSheetDragMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      const deltaMilliseconds = now - drag.lastTime;
      if (deltaMilliseconds > 0) {
        const instantVelocity =
          (drag.lastY - event.clientY) / deltaMilliseconds;
        drag.velocity =
          drag.velocity * (1 - VELOCITY_SMOOTHING) +
          instantVelocity * VELOCITY_SMOOTHING;
      }
      drag.lastY = event.clientY;
      drag.lastTime = now;

      const raw =
        drag.startHeight + (drag.startClientY - event.clientY);
      jumpTo(presentHeight(raw, drag.caps.full));
    },
    [jumpTo],
  );

  const onSheetDragEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag?.active) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);

      const raw =
        drag.startHeight + (drag.startClientY - event.clientY);
      const releaseHeight = presentHeight(raw, drag.caps.full);
      const paused = performance.now() - drag.lastTime > RELEASE_PAUSE_MS;
      const velocity = paused ? 0 : drag.velocity;
      const { snap, dismissed } = resolveSheetHeightSnap({
        viewportHeight: drag.viewportHeight,
        startSnap: drag.startSnap,
        startHeightPx: drag.startHeight,
        releaseHeightPx: releaseHeight,
        velocity,
        caps: drag.caps,
      });

      if (dismissed) {
        dismissWithVelocity(velocity);
        return;
      }

      setRestingSnap(snap);
      animateTo(drag.caps[snap], {
        velocity: velocity * 1000,
        dampingRatio:
          Math.abs(velocity) >= MOMENTUM_VELOCITY_THRESHOLD ? 0.8 : 1,
      });
    },
    [animateTo, dismissWithVelocity],
  );

  return {
    sheetSnap,
    setSheetSnap,
    settleToRest,
    openAtSnap,
    requestDismiss,
    recapToViewport,
    sheetHeight,
    dragging,
    settling,
    entering,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  };
}
