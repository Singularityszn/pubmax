"use client";

import { useCallback, useRef } from "react";
import { ChevronUp } from "lucide-react";

import { mapPeekSummary, type MapPeekModel } from "@/lib/mapPeek";
import { useSpringValue } from "@/lib/useSpringValue";

// The phone map's resting sheet: one card at the foot of the map that answers
// "where is the cheapest listed price in this view" and holds the way into a
// Plan. It is the ONE bottom layer, so the plan door rides inside it rather than
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

function peekDragOrigin(offset: number): number {
  const resisted = offset > 0 ? offset : -offset - FREE_UPWARD_TRAVEL_PX;
  if (resisted <= 0) return offset;
  const distance = (resisted * RUBBERBAND_DIMENSION_PX) /
    (RUBBERBAND_CONSTANT * (RUBBERBAND_DIMENSION_PX - resisted));
  return offset > 0 ? distance : -FREE_UPWARD_TRAVEL_PX - distance;
}

export function peekShouldOpenList(upwardPx: number, upwardVelocityPxPerMs: number): boolean {
  if (upwardPx >= PEEK_COMMIT_DISTANCE_PX) return true;
  return (
    upwardVelocityPxPerMs >= PEEK_COMMIT_VELOCITY && upwardPx >= PEEK_FLICK_MIN_DISTANCE_PX
  );
}

/** What the card's line says when it has no answer. Only "none" is a finding;
 *  the others are a read still running, failed or incomplete. */
const QUIET_LINES: Record<Exclude<MapPeekModel["status"], "answer">, string> = {
  loading: "Counting them up…",
  unavailable: "Browse the pub directory",
  none: "No listed price here yet",
  unread: "Could not read prices just now",
  partial: "Some prices still missing",
};

type DragState = {
  pointerId: number;
  captureTarget: Element;
  startY: number;
  originOffset: number;
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
  const pressedButtonRef = useRef<HTMLButtonElement | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const originOffset = peekDragOrigin(stop().value);
      const target = event.target as Element;
      const captureTarget = event.currentTarget;
      pressedButtonRef.current = target.closest("button");
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {}
      draggedRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        captureTarget,
        startY: event.clientY,
        originOffset,
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
      jumpTo(peekPresentedOffset(drag.originOffset + dy));
    },
    [jumpTo],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      const button = pressedButtonRef.current;
      draggedRef.current = drag.active || cancelled || (
        button !== null && (!button.isConnected || !button.contains(document.elementFromPoint(event.clientX, event.clientY)))
      );
      try {
        if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
          drag.captureTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Nothing to release.
      }
      if (!drag.active) {
        animateTo(0);
        return;
      }
      const upward = drag.startY - event.clientY - drag.originOffset;
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

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.detail === 0) return;
    const button = pressedButtonRef.current;
    pressedButtonRef.current = null;
    const dragged = draggedRef.current;
    draggedRef.current = false;
    if (dragged) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target === event.currentTarget && button?.isConnected) {
      event.preventDefault();
      event.stopPropagation();
      button.click();
    }
  }, []);

  const summary = mapPeekSummary(model);

  return (
    <section
      className="mapPeek"
      aria-label={model.status === "unavailable" ? "Map unavailable" : "Cheapest in this view"}
      data-state={model.status}
      data-covered={covered ? "true" : undefined}
      data-dragging={running || offset !== 0 ? "true" : undefined}
      style={offset !== 0 ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onLostPointerCapture={(event) => {
        if (event.target === dragRef.current?.captureTarget) finishDrag(event, true);
      }}
      onClickCapture={onClickCapture}
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
            <span className="mapPeekEyebrow">
              <span>Cheapest in this view</span>
              {model.answer.lineLabel !== null ? (
                <span className="mapPeekLabel">· {model.answer.lineLabel}</span>
              ) : null}
            </span>
            <span className="mapPeekLine">
              <span className="mapPeekPrice">{model.answer.figureLabel}</span>
              <span className="mapPeekName">{model.answer.name}</span>
              {model.answer.walkMinutes !== null ? (
                <span className="mapPeekWalk">{model.answer.walkMinutes} min walk</span>
              ) : null}
            </span>
          </button>
        ) : (
          <div className="mapPeekAnswer isQuiet" role="status">
            <span className="mapPeekEyebrow">{model.status === "unavailable" ? "Map unavailable" : "Cheapest in this view"}</span>
            <span className="mapPeekLine">
              {model.status === "loading" ? (
                <span className="mapPeekSkeleton" aria-hidden="true" />
              ) : null}
              <span className={model.status === "none" ? "mapPeekName" : "mapPeekHush"}>
                {QUIET_LINES[model.status]}
              </span>
            </span>
          </div>
        )}
        <button
          type="button"
          className="mapPeekList"
          aria-label={model.status === "unavailable" ? "Browse pubs without the map" : "Show the pubs in this view as a list"}
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
