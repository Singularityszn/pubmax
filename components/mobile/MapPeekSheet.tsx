"use client";

import { useCallback, useRef } from "react";
import { ChevronUp } from "lucide-react";

import { mapPeekSummary, type MapPeekModel } from "@/lib/mapPeek";
import { useSpringValue } from "@/lib/useSpringValue";

// The phone map's resting sheet: one card at the foot of the map that answers
// "where is the cheap pint in this view" and holds the way into a Plan. It is
// the ONE bottom layer, so the plan door rides inside it as a child rather than
// floating beside it. Drag it up to open the venue list.
//
// It moves by TRANSFORM only (the box never resizes), tracks the finger 1:1,
// rubber-bands at both ends and hands the release velocity to a critically
// damped spring. It commits on distance or on a flick, never on a detent tick:
// lib/nativeHaptics.ts keeps haptics for kept actions, so this surface has none.

/** Upward travel at release that opens the list without a flick, in px. */
export const PEEK_COMMIT_DISTANCE_PX = 56;
/** Upward release speed that opens the list without the distance, in px/ms. */
export const PEEK_COMMIT_VELOCITY = 0.5;
/** A flick must still have gone somewhere. */
const PEEK_FLICK_MIN_DISTANCE_PX = 12;
/** Travel before a press becomes a drag, so a tap is never swallowed. */
const DRAG_SLOP_PX = 8;
/** Upward travel the card follows 1:1. Past it the card resists, because the
 *  list has already been earned and a finger can still go further. */
const FREE_UPWARD_TRAVEL_PX = 96;
const RUBBERBAND_CONSTANT = 0.55;
const RUBBERBAND_DIMENSION_PX = 200;
const VELOCITY_SMOOTHING = 0.55;
const RELEASE_PAUSE_MS = 66;

function rubberband(overshoot: number): number {
  const d = RUBBERBAND_DIMENSION_PX;
  return (overshoot * d * RUBBERBAND_CONSTANT) / (d + RUBBERBAND_CONSTANT * Math.abs(overshoot));
}

/**
 * Where the card sits for a finger that has moved `dy` px (negative = up).
 * Upward it is the finger, 1:1, for the first stretch and then it resists.
 * Downward there is nothing to go to, so it resists from the first pixel.
 */
export function peekPresentedOffset(dy: number): number {
  if (dy >= 0) return rubberband(dy);
  const up = -dy;
  return -(up <= FREE_UPWARD_TRAVEL_PX
    ? up
    : FREE_UPWARD_TRAVEL_PX + rubberband(up - FREE_UPWARD_TRAVEL_PX));
}

export function peekShouldOpenList(upwardPx: number, upwardVelocityPxPerMs: number): boolean {
  if (upwardPx >= PEEK_COMMIT_DISTANCE_PX) return true;
  return (
    upwardVelocityPxPerMs >= PEEK_COMMIT_VELOCITY && upwardPx >= PEEK_FLICK_MIN_DISTANCE_PX
  );
}

type DragState = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  /** Upward speed in px/ms, smoothed. */
  velocity: number;
  active: boolean;
};

export default function MapPeekSheet({
  model,
  onOpenVenue,
  onOpenList,
  covered = false,
  children,
}: {
  model: MapPeekModel;
  onOpenVenue: (venueId: string) => void;
  onOpenList: () => void;
  /**
   * Something else owns the foot of the map (a pub, a sheet, the list). The
   * card stays MOUNTED and is simply not painted or hit, because the map-edge
   * column and the Pub Pal berth are derived from its presence and would
   * otherwise jump behind the sheet that is opening.
   */
  covered?: boolean;
  /** The plan door, or nothing while the card is covered. */
  children?: React.ReactNode;
}) {
  const { value: offset, running, animateTo, jumpTo, stop } = useSpringValue(0, {
    response: 0.34,
    dampingRatio: 1,
  });
  const dragRef = useRef<DragState | null>(null);
  const draggedRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      stop();
      draggedRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocity: 0,
        active: false,
      };
    },
    [stop],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dy = event.clientY - drag.startY;
      if (!drag.active) {
        // Only an upward pull is this card's gesture: a downward or sideways
        // press stays a tap, and the map beneath never sees either.
        if (-dy < DRAG_SLOP_PX) return;
        drag.active = true;
        draggedRef.current = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone (cancelled, or a synthetic event): the
          // drag still tracks off the card's own move events.
        }
      }
      event.preventDefault();
      const now = performance.now();
      const elapsed = now - drag.lastTime;
      if (elapsed > 0) {
        const instant = (drag.lastY - event.clientY) / elapsed;
        drag.velocity = drag.velocity * (1 - VELOCITY_SMOOTHING) + instant * VELOCITY_SMOOTHING;
      }
      drag.lastY = event.clientY;
      drag.lastTime = now;
      jumpTo(peekPresentedOffset(dy));
    },
    [jumpTo],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (!drag.active) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Nothing to release.
      }
      // The click that follows a drag's pointerup is the drag's, and is
      // swallowed; the flag clears after it so a later keyboard click is not.
      window.setTimeout(() => {
        draggedRef.current = false;
      }, 100);
      const upward = drag.startY - event.clientY;
      const paused = performance.now() - drag.lastTime > RELEASE_PAUSE_MS;
      const velocity = paused ? 0 : drag.velocity;
      if (!cancelled && peekShouldOpenList(upward, velocity)) {
        // The list takes the surface; the card stands down behind it. Settling
        // first would draw the card dropping back under a list rising over it,
        // so it goes home in the same commit that covers it.
        jumpTo(0);
        onOpenList();
        return;
      }
      animateTo(0, { velocity: -velocity * 1000, dampingRatio: 1 });
    },
    [animateTo, jumpTo, onOpenList],
  );

  // A drag that began on a button must not end as that button's click.
  const swallowClickAfterDrag = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const summary = mapPeekSummary(model);

  return (
    <section
      className="mapPeek"
      aria-label="Cheapest in this view"
      data-state={model.status}
      data-covered={covered ? "true" : undefined}
      data-dragging={running || offset !== 0 ? "true" : undefined}
      style={offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onClickCapture={swallowClickAfterDrag}
    >
      <span className="mapPeekGrab" aria-hidden="true" />
      <div className="mapPeekRow">
        {model.status === "answer" ? (
          <button
            type="button"
            className="mapPeekAnswer"
            aria-label={`${summary}. Open this ${model.answer.isPub ? "pub" : "venue"}`}
            onClick={() => onOpenVenue(model.answer.venueId)}
          >
            <span className="mapPeekEyebrow">Cheapest in this view</span>
            <span className="mapPeekLine">
              {model.answer.lineLabel !== null ? (
                <span className="mapPeekLabel">{model.answer.lineLabel} ·</span>
              ) : null}
              <span className="mapPeekPrice">{model.answer.figureLabel}</span>
              <span className="mapPeekName">{model.answer.name}</span>
              {model.answer.walkMinutes !== null ? (
                <span className="mapPeekWalk">{model.answer.walkMinutes} min walk</span>
              ) : null}
            </span>
          </button>
        ) : (
          <div className="mapPeekAnswer isQuiet" role="status">
            <span className="mapPeekEyebrow">Cheapest in this view</span>
            <span className="mapPeekLine">
              {model.status === "loading" ? (
                <span className="mapPeekSkeleton" aria-hidden="true" />
              ) : null}
              <span className={model.status === "loading" ? "mapPeekHush" : "mapPeekName"}>
                {model.status === "loading" ? "Counting them up…" : "No listed price here yet"}
              </span>
            </span>
          </div>
        )}
        <button
          type="button"
          className="mapPeekList"
          aria-label="Show the pubs in this view as a list"
          onClick={onOpenList}
        >
          <ChevronUp size={16} aria-hidden="true" />
          <span>List</span>
        </button>
      </div>
      {children}
    </section>
  );
}
