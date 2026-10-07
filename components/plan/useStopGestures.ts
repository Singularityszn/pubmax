"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { haptic } from "@/lib/nativeHaptics";
import { dropIndex, reorderShifts, type StopSlot } from "@/lib/planStopReorder";
import { projectMomentum, type SpringConfig } from "@/lib/springMotion";
import { releaseVelocity, rubberband, springTo } from "@/lib/springAnimate";

// What a Stop card does under a thumb or a mouse: lift and reorder, or swipe to
// show Remove. Both write straight to the element's transform while the finger
// is down, because a drag that waits for React is a drag that lags (the card
// must stay glued to the pointer, at the offset it was grabbed). React only
// hears about the ends: which card is lifted, and the final order.
//
// RULES THIS FOLLOWS (lib/nativeHaptics.ts, lib/springMotion.ts):
//   - A touch lifts after a still hold, so a scroll that starts on a card is
//     still a scroll. A mouse lifts once it has moved a few pixels.
//   - The drop settles on a spring (response 0.3, damping 0.8: the release
//     carried momentum, so a little give is right) from the card's live offset
//     and velocity. Nothing is ever restarted from the target.
//   - A changed order uses `selection-kept` after a drop or a keyboard reorder.
//     Crossing a slot ticks nothing: a haptic is for a kept action, never for
//     movement.
//   - Reduced motion: no spring, the card lands at once.

const HOLD_MS = 350;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 6;
const SETTLE: SpringConfig = { response: 0.3, dampingRatio: 0.8 };
const GLIDE: SpringConfig = { response: 0.3, dampingRatio: 1 };

/** How far the card slides to show Remove. Matches `--stop-tray` in the CSS. */
const STOP_TRAY_PX = 96;

type Mode = "pending" | "drag" | "swipe";

type Gesture = {
  liftable: boolean;
  index: number;
  pointerId: number;
  pointerType: string;
  surface: HTMLElement;
  startX: number;
  startY: number;
  mode: Mode;
  holdTimer: ReturnType<typeof setTimeout> | null;
  slots: StopSlot[];
  target: number;
  offset: number;
  swipeFrom: number;
  lastPosition: number;
  lastTime: number;
  velocity: number;
};

export function useStopGestures({
  list,
  onReorder,
  revealedKey,
  keys,
  onReveal,
  firstLocked,
  swipeable,
  refreshKey,
}: {
  /** The list the cards sit in. Its touch handling is in place before any touch starts. */
  list: RefObject<HTMLElement | null>;
  onReorder: (from: number, to: number) => void;
  revealedKey: number | null;
  keys: readonly number[];
  onReveal: (key: number | null) => void;
  /** A held pub is Stop 1 for good: it never lifts and nothing lands above it. */
  firstLocked: boolean;
  /** Whether a card has a Remove to show. Without one there is nothing to swipe to. */
  swipeable: (index: number) => boolean;
  /** A new route remounts every card, so a gesture on the old ones is dropped. */
  refreshKey: number;
}) {
  const [liftedIndex, setLiftedIndex] = useState<number | null>(null);
  const items = useRef<Array<HTMLElement | null>>([]);
  const gesture = useRef<Gesture | null>(null);
  const cancelSpring = useRef<() => void>(() => {});
  const releasePointer = useRef<() => void>(() => {});
  const swallowClick = useRef(false);
  const callbacks = useRef({ onReorder, onReveal, revealedKey, keys, firstLocked, swipeable });
  useEffect(() => {
    callbacks.current = { onReorder, onReveal, revealedKey, keys, firstLocked, swipeable };
  }, [onReorder, onReveal, revealedKey, keys, firstLocked, swipeable]);

  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const blockScroll = (event: TouchEvent) => {
      if (gesture.current?.mode === "drag" && event.cancelable) event.preventDefault();
    };
    node.addEventListener("touchmove", blockScroll, { passive: false });
    return () => node.removeEventListener("touchmove", blockScroll);
  }, [list, refreshKey]);

  const clearTransforms = useCallback(() => {
    for (const element of items.current) {
      if (!element) continue;
      element.style.transform = "";
      element.style.zIndex = "";
      element.removeAttribute("data-drag-role");
    }
  }, []);

  // The end of a gesture is heard on the window, so a pointer that leaves its
  // card, or a card that leaves the page, still ends it.
  const abandon = useCallback(() => {
    const current = gesture.current;
    if (current?.holdTimer) clearTimeout(current.holdTimer);
    gesture.current = null;
    cancelSpring.current();
    releasePointer.current();
    setLiftedIndex(null);
  }, []);

  useEffect(() => abandon, [refreshKey, abandon]);

  // A card that left the list leaves its slot behind; only live cards are measured.
  useLayoutEffect(() => {
    items.current.length = keys.length;
  }, [keys]);

  const lift = useCallback((current: Gesture) => {
    current.mode = "drag";
    current.slots = items.current.map((element) => {
      const rect = (element?.querySelector<HTMLElement>(".planStop__card") ?? element)?.getBoundingClientRect();
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 };
    });
    current.target = current.index;
    try {
      current.surface.setPointerCapture(current.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    setLiftedIndex(current.index);
    for (const [index, element] of items.current.entries()) {
      element?.setAttribute("data-drag-role", index === current.index ? "lifted" : "neighbour");
    }
    items.current[current.index]?.style.setProperty("z-index", "3");
  }, []);

  const settleDrag = useCallback((current: Gesture, commit: boolean) => {
    const element = items.current[current.index];
    const to = commit ? current.target : current.index;
    const shifts = reorderShifts(current.slots, current.index, to);
    const rest = shifts[current.index] ?? 0;
    for (const [index, other] of items.current.entries()) {
      if (!other || index === current.index) continue;
      other.style.transform = shifts[index] ? `translate3d(0, ${shifts[index]}px, 0)` : "";
    }
    // Momentum decides the landing only through the slot the card is over; the
    // spring then carries the release velocity into it.
    cancelSpring.current = springTo(
      current.offset,
      current.velocity * 1000,
      rest,
      SETTLE,
      (value) => {
        if (element) element.style.transform = `translate3d(0, ${value}px, 0)`;
      },
      () => {
        gesture.current = null;
        const moved = commit && to !== current.index;
        // The new order commits in this frame, so the cards never paint back
        // in their old places with their transforms gone.
        flushSync(() => {
          setLiftedIndex(null);
          if (moved) callbacks.current.onReorder(current.index, to);
        });
        clearTransforms();
        if (moved) haptic("selection-kept");
      },
    );
  }, [clearTransforms]);

  const settleSwipe = useCallback((current: Gesture) => {
    const surface = current.surface;
    const open = current.offset < -STOP_TRAY_PX / 2
      || projectMomentum(current.offset, current.velocity) < -STOP_TRAY_PX;
    const rest = open ? -STOP_TRAY_PX : 0;
    const key = callbacks.current.keys[current.index] ?? null;
    cancelSpring.current = springTo(
      current.offset,
      current.velocity * 1000,
      rest,
      GLIDE,
      (value) => {
        surface.style.transform = `translate3d(${value}px, 0, 0)`;
      },
      () => {
        gesture.current = null;
        flushSync(() => callbacks.current.onReveal(open ? key : null));
        surface.style.transform = "";
        items.current[current.index]?.removeAttribute("data-swipe");
      },
    );
  }, []);

  const end = useCallback((event: globalThis.PointerEvent, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.holdTimer) clearTimeout(current.holdTimer);
    current.holdTimer = null;
    if (current.mode === "pending") {
      gesture.current = null;
      return;
    }
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false;
    }, 0);
    current.velocity = releaseVelocity(current.velocity, current.lastTime, event.timeStamp);
    if (current.mode === "drag") settleDrag(current, !cancelled);
    else settleSwipe(current);
  }, [settleDrag, settleSwipe]);

  const onPointerDown = useCallback((index: number) => (event: PointerEvent<HTMLElement>) => {
    if (gesture.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-stop-action]")) return;
    // A held first stop can still be swiped for Remove, but never lifted.
    const liftable = !(callbacks.current.firstLocked && index === 0);
    cancelSpring.current();
    const current: Gesture = {
      liftable: true,
      index,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      surface: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      mode: "pending",
      holdTimer: null,
      slots: [],
      target: index,
      offset: 0,
      swipeFrom: callbacks.current.revealedKey === callbacks.current.keys[index] ? -STOP_TRAY_PX : 0,
      lastPosition: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
    current.liftable = liftable;
    gesture.current = current;
    releasePointer.current();
    function release() {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (releasePointer.current === release) releasePointer.current = () => {};
    }
    function finish(pointer: globalThis.PointerEvent) {
      if (pointer.pointerId !== current.pointerId) return;
      release();
      end(pointer, pointer.type === "pointercancel");
    }
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    releasePointer.current = release;
    if (event.pointerType !== "mouse" && liftable) {
      current.holdTimer = setTimeout(() => {
        current.holdTimer = null;
        if (gesture.current === current && current.mode === "pending") lift(current);
      }, HOLD_MS);
    }
  }, [end, lift]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;

    if (current.mode === "pending") {
      const touch = current.pointerType !== "mouse";
      if (touch) {
        // Past the slop the hold is spent: a horizontal drift is a swipe, a
        // vertical one is the page scrolling, and the browser takes it.
        if (Math.hypot(dx, dy) > TOUCH_SLOP) {
          if (current.holdTimer) clearTimeout(current.holdTimer);
          current.holdTimer = null;
          if (Math.abs(dx) > Math.abs(dy) && callbacks.current.swipeable(current.index)) {
            current.mode = "swipe";
            items.current[current.index]?.setAttribute("data-swipe", "true");
            current.lastPosition = event.clientX;
            current.lastTime = event.timeStamp;
            try {
              current.surface.setPointerCapture(current.pointerId);
            } catch {
              /* gone */
            }
          } else {
            gesture.current = null;
          }
        }
      } else if (Math.hypot(dx, dy) > MOUSE_SLOP && current.liftable) {
        lift(current);
      }
      if (current.mode === "pending") return;
    }

    const position = current.mode === "swipe" ? event.clientX : event.clientY;
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) {
      const instant = (position - current.lastPosition) / elapsed;
      current.velocity = current.velocity * 0.6 + instant * 0.4;
    }
    current.lastPosition = position;
    current.lastTime = event.timeStamp;

    if (current.mode === "swipe") {
      const raw = current.swipeFrom + dx;
      current.offset = raw > 0
        ? rubberband(raw, STOP_TRAY_PX)
        : raw < -STOP_TRAY_PX
          ? -STOP_TRAY_PX - rubberband(-STOP_TRAY_PX - raw, STOP_TRAY_PX)
          : raw;
      current.surface.style.transform = `translate3d(${current.offset}px, 0, 0)`;
      return;
    }

    current.offset = dy;
    const dragged = items.current[current.index];
    if (dragged) dragged.style.transform = `translate3d(0, ${dy}px, 0)`;
    const lowest = callbacks.current.firstLocked ? 1 : 0;
    const target = Math.max(lowest, dropIndex(current.slots, current.index, dy));
    if (target !== current.target) {
      current.target = target;
      const shifts = reorderShifts(current.slots, current.index, target);
      for (const [index, element] of items.current.entries()) {
        if (!element || index === current.index) continue;
        element.style.transform = shifts[index] ? `translate3d(0, ${shifts[index]}px, 0)` : "";
      }
    }
  }, [lift]);

  const onClickCapture = useCallback((index: number) => (event: MouseEvent<HTMLElement>) => {
    if (swallowClick.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // A tap on a card that is showing Remove closes it instead of opening the pub.
    const key = callbacks.current.keys[index];
    if (key !== undefined && callbacks.current.revealedKey === key) {
      event.preventDefault();
      event.stopPropagation();
      callbacks.current.onReveal(null);
    }
  }, []);

  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    const current = gesture.current;
    if (current?.mode === "drag" && current.pointerType !== "mouse") event.preventDefault();
  }, []);

  const onKeyDown = useCallback((index: number, count: number) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const to = event.key === "ArrowUp" ? index - 1 : index + 1;
    const lowest = callbacks.current.firstLocked ? 1 : 0;
    if (to < lowest || to >= count || index < lowest) return;
    event.preventDefault();
    callbacks.current.onReorder(index, to);
    haptic("selection-kept");
  }, []);

  const itemRef = useCallback((index: number) => (element: HTMLElement | null) => {
    items.current[index] = element;
  }, []);

  return { liftedIndex, itemRef, onPointerDown, onPointerMove, onClickCapture, onContextMenu, onKeyDown };
}
