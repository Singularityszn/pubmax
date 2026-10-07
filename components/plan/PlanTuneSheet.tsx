"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import "./planTuneSheet.css";
import { releaseVelocity, springTo } from "@/lib/springAnimate";
import type { SpringConfig } from "@/lib/springMotion";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";
import { useFocusTrap } from "@/lib/useFocusTrap";

// The settings sheet over the Plan result. On a phone it is a bottom sheet that
// opens at its half detent and can be pulled to full or swiped away; at desktop
// width it is a centred dialog. Same content either way.
//
// The drag is 1:1 with the finger and settles on a critically damped spring
// from its live offset (Apple: bounce only when the gesture itself carried
// momentum, and a sheet dismissed by a flick is the one place that applies, so
// the dismissal keeps the release velocity but not an overshoot). No haptic
// rides the detents: lib/nativeHaptics.ts rule 1 keeps ticks for kept actions.

const GLIDE: SpringConfig = { response: 0.3, dampingRatio: 1 };
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 0.5;
const EXPAND_PX = 60;
/** Movement before a press on the header becomes a drag, so the grab handle still takes a tap. */
const DRAG_SLOP = 4;
/** The width at which the sheet is a centred dialog (planTuneSheet.css), which does not drag. */
const DIALOG_QUERY = "(min-width: 641px)";

type Detent = "half" | "full";

export default function PlanTuneSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const [detent, setDetent] = useState<Detent>("half");
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number;
    downY: number;
    startY: number;
    offset: number;
    lastY: number;
    lastT: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  const live = useRef(0);
  const pressedOutside = useRef(false);
  const cancelSpring = useRef<() => void>(() => {});
  const [closing, setClosing] = useState(false);
  // Every opening starts at the half detent, wherever the last one was left.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDetent("half");
    else {
      setDragging(false);
      setClosing(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useFocusTrap(open, sheetRef, "strict-modal", originRef);
  useDismissOnEscape(open, onClose, sheetRef);

  useEffect(() => {
    if (!open) return;
    const spring = cancelSpring;
    return () => {
      spring.current();
      drag.current = null;
      live.current = 0;
    };
  }, [open]);

  const write = useCallback((value: number) => {
    live.current = value;
    if (sheetRef.current) sheetRef.current.style.transform = value === 0 ? "" : `translate3d(0, ${value}px, 0)`;
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".planTune__close")) return;
    if (window.matchMedia?.(DIALOG_QUERY).matches) return;
    cancelSpring.current();
    setClosing(false);
    const from = live.current;
    drag.current = {
      pointerId: event.pointerId,
      downY: event.clientY,
      startY: event.clientY - (from < 0 ? from / 0.25 : from),
      offset: from,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      if (Math.abs(event.clientY - current.downY) <= DRAG_SLOP) return;
      current.moved = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      setDragging(true);
    }
    const dy = event.clientY - current.startY;
    const elapsed = event.timeStamp - current.lastT;
    if (elapsed > 0) current.velocity = current.velocity * 0.6 + ((event.clientY - current.lastY) / elapsed) * 0.4;
    current.lastY = event.clientY;
    current.lastT = event.timeStamp;
    // Pulling up past the top edge gives way: the sheet never leaves its anchor.
    current.offset = dy < 0 ? dy * 0.25 : dy;
    write(current.offset);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) {
      if (current.offset !== 0) cancelSpring.current = springTo(current.offset, 0, 0, GLIDE, write, () => write(0));
      return;
    }
    setDragging(false);
    const velocity = releaseVelocity(current.velocity, current.lastT, event.timeStamp);
    const height = sheetRef.current?.getBoundingClientRect().height ?? 600;
    const dismiss = current.offset > DISMISS_PX || velocity > DISMISS_VELOCITY;
    if (dismiss) {
      setClosing(true);
      cancelSpring.current = springTo(current.offset, velocity * 1000, height, GLIDE, write, () => {
        setClosing(false);
        write(0);
        onClose();
      });
      return;
    }
    if (current.offset < -EXPAND_PX * 0.25 && detent === "half") setDetent("full");
    cancelSpring.current = springTo(current.offset, velocity * 1000, 0, GLIDE, write, () => write(0));
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="planTune"
      data-detent={detent}
      data-closing={closing ? "true" : undefined}
      onPointerDown={(event) => {
        pressedOutside.current = !sheetRef.current?.contains(event.target as Node);
      }}
      onClick={(event) => {
        if (pressedOutside.current && !sheetRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className="planTune__scrim" aria-hidden="true" />
      <section
        ref={sheetRef}
        className="planTune__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-dragging={dragging ? "true" : undefined}
      >
        <header
          className="planTune__header"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <button
            type="button"
            className="planTune__grab"
            aria-label={detent === "full" ? "Show less" : "Show more"}
            onClick={() => setDetent(detent === "full" ? "half" : "full")}
          >
            <span aria-hidden="true" />
          </button>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="planTune__close" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="planTune__body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
